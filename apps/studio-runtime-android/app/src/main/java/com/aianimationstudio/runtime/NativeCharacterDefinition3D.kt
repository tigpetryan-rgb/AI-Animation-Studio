package com.aianimationstudio.runtime

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

internal const val NATIVE_CHARACTER_DEFINITION_3D_SCHEMA_VERSION = 1
private const val NATIVE_CHARACTER_DEFINITION_3D_MAX_REFERENCE_BYTES = 32 * 1024 * 1024
private const val NATIVE_CHARACTER_DEFINITION_3D_MAX_DIMENSION = 32_768
private const val NATIVE_CHARACTER_DEFINITION_3D_MANIFEST_NAME = "character-definition.manifest"
private const val NATIVE_CHARACTER_DEFINITION_3D_ASSET_NAME = "character.aichar3d"
private const val NATIVE_CHARACTER_DEFINITION_3D_REFERENCE_NAME = "reference-image.bin"

/**
 * Exact reference appearance owned by a reusable Phase-3 character definition.
 *
 * The production renderer can continue deriving palette/texture projection from the admitted image,
 * but the exact admitted bytes now travel with the character definition instead of being only an
 * external dependency. This makes appearance identity reproducible after save/reopen.
 */
internal class NativeCharacterReferenceAppearance3D(
    val displayName: String,
    val mimeType: String,
    val width: Int,
    val height: Int,
    val referenceSha256: String,
    referenceBytes: ByteArray,
) {
    val referenceBytes: ByteArray = referenceBytes.copyOf()
    val sizeBytes: Int get() = referenceBytes.size

    override fun equals(other: Any?): Boolean =
        other is NativeCharacterReferenceAppearance3D &&
            displayName == other.displayName &&
            mimeType == other.mimeType &&
            width == other.width &&
            height == other.height &&
            referenceSha256 == other.referenceSha256 &&
            referenceBytes.contentEquals(other.referenceBytes)

    override fun hashCode(): Int {
        var result = displayName.hashCode()
        result = 31 * result + mimeType.hashCode()
        result = 31 * result + width
        result = 31 * result + height
        result = 31 * result + referenceSha256.hashCode()
        result = 31 * result + referenceBytes.contentHashCode()
        return result
    }
}

internal data class NativeCharacterDefinition3D(
    val schemaVersion: Int,
    val asset: NativeCharacterAsset3D,
    val appearance: NativeCharacterReferenceAppearance3D,
) {
    val definitionId: String get() = "definition-${asset.assetId}"

    fun materializeReference(targetFile: File): PersistedReferenceAsset {
        val diagnostics = NativeCharacterDefinition3DValidator.validate(this)
        require(diagnostics.isEmpty()) {
            "Reusable character definition failed validation: ${diagnostics.joinToString { it.code }}"
        }
        writeCharacterDefinitionFileAtomically(targetFile, appearance.referenceBytes)
        val actualSha = sha256HexCharacterDefinition(targetFile)
        require(actualSha == appearance.referenceSha256) { "Materialized character reference identity changed." }
        return PersistedReferenceAsset(
            displayName = appearance.displayName,
            mimeType = appearance.mimeType,
            sizeBytes = appearance.referenceBytes.size.toLong(),
            width = appearance.width,
            height = appearance.height,
            sha256 = appearance.referenceSha256,
            originUri = "character-definition://${asset.assetId}/reference",
            localFile = targetFile,
        )
    }
}

internal sealed interface NativeCharacterDefinition3DResult {
    data class Ready(val definition: NativeCharacterDefinition3D) : NativeCharacterDefinition3DResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeCharacterDefinition3DResult
}

/** Captures a fully reusable Phase-3 character definition from one admitted production snapshot. */
internal object NativeCharacterDefinition3DFactory {
    fun capture(
        snapshot: NativeProductionSnapshot,
        reference: PersistedReferenceAsset,
    ): NativeCharacterDefinition3DResult {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        if (snapshot.stage != NativeProductionStage.READY_FOR_RENDER) {
            diagnostics += NativeDiagnostic(
                "CHARACTER_DEFINITION_STAGE",
                "Phase-3 character capture requires a READY_FOR_RENDER source-bound production snapshot.",
            )
        }
        val rig = snapshot.rig
        val model = snapshot.model3d
        if (rig == null || model == null) {
            diagnostics += NativeDiagnostic(
                "CHARACTER_DEFINITION_MODEL",
                "Phase-3 character capture requires the validated humanoid rig and real 3D mesh.",
            )
        }
        if (
            snapshot.referenceSha256 != reference.sha256 ||
            rig?.referenceSha256 != reference.sha256 ||
            model?.referenceSha256 != reference.sha256
        ) {
            diagnostics += NativeDiagnostic(
                "CHARACTER_DEFINITION_REFERENCE_CONTINUITY",
                "Character definition reference identity changed between source, rig and mesh.",
            )
        }
        if (reference.mimeType.isBlank() || !reference.mimeType.startsWith("image/")) {
            diagnostics += NativeDiagnostic(
                "CHARACTER_DEFINITION_MIME",
                "Character definition requires an admitted image reference MIME type.",
            )
        }
        if (reference.width !in 1..NATIVE_CHARACTER_DEFINITION_3D_MAX_DIMENSION || reference.height !in 1..NATIVE_CHARACTER_DEFINITION_3D_MAX_DIMENSION) {
            diagnostics += NativeDiagnostic(
                "CHARACTER_DEFINITION_DIMENSIONS",
                "Character definition reference dimensions are invalid or exceed the bounded production contract.",
            )
        }
        if (
            !reference.localFile.isFile ||
            reference.sizeBytes !in 1L..NATIVE_CHARACTER_DEFINITION_3D_MAX_REFERENCE_BYTES.toLong() ||
            reference.localFile.length() != reference.sizeBytes
        ) {
            diagnostics += NativeDiagnostic(
                "CHARACTER_DEFINITION_REFERENCE_FILE",
                "Character definition requires the exact bounded persisted reference bytes.",
            )
        }
        if (diagnostics.isNotEmpty() || rig == null || model == null) {
            return NativeCharacterDefinition3DResult.Rejected(diagnostics.distinctBy { it.code to it.message })
        }

        val referenceBytes = try {
            FileInputStream(reference.localFile).use { it.readBytes() }
        } catch (_: Exception) {
            return NativeCharacterDefinition3DResult.Rejected(
                listOf(NativeDiagnostic("CHARACTER_DEFINITION_REFERENCE_READ", "Character reference bytes could not be read for durable identity capture.")),
            )
        }
        if (referenceBytes.size != reference.sizeBytes.toInt()) {
            return NativeCharacterDefinition3DResult.Rejected(
                listOf(NativeDiagnostic("CHARACTER_DEFINITION_REFERENCE_SIZE", "Character reference size changed during durable identity capture.")),
            )
        }
        val actualReferenceSha = sha256HexCharacterDefinition(referenceBytes)
        if (actualReferenceSha != reference.sha256) {
            return NativeCharacterDefinition3DResult.Rejected(
                listOf(NativeDiagnostic("CHARACTER_DEFINITION_REFERENCE_HASH", "Character reference bytes no longer match the admitted SHA-256 identity.")),
            )
        }
        if (!hasAdmittedImageSignature(reference.mimeType, referenceBytes)) {
            return NativeCharacterDefinition3DResult.Rejected(
                listOf(NativeDiagnostic("CHARACTER_DEFINITION_REFERENCE_SIGNATURE", "Character reference bytes do not match the admitted image container signature.")),
            )
        }

        val asset = when (val result = NativeCharacterAsset3DFactory.capture(model, rig)) {
            is NativeCharacterAsset3DResult.Ready -> result.asset
            is NativeCharacterAsset3DResult.Rejected -> return NativeCharacterDefinition3DResult.Rejected(result.diagnostics)
        }
        val definition = NativeCharacterDefinition3D(
            schemaVersion = NATIVE_CHARACTER_DEFINITION_3D_SCHEMA_VERSION,
            asset = asset,
            appearance = NativeCharacterReferenceAppearance3D(
                displayName = reference.displayName.ifBlank { "character-reference" },
                mimeType = reference.mimeType,
                width = reference.width,
                height = reference.height,
                referenceSha256 = reference.sha256,
                referenceBytes = referenceBytes,
            ),
        )
        val validation = NativeCharacterDefinition3DValidator.validate(definition)
        return if (validation.isEmpty()) {
            NativeCharacterDefinition3DResult.Ready(definition)
        } else {
            NativeCharacterDefinition3DResult.Rejected(validation)
        }
    }
}

internal object NativeCharacterDefinition3DValidator {
    private val sha256 = Regex("^[0-9a-f]{64}$")
    private val admittedMime = Regex("^image/[A-Za-z0-9.+-]{1,80}$")

    fun validate(definition: NativeCharacterDefinition3D): List<NativeDiagnostic> = buildList {
        if (definition.schemaVersion != NATIVE_CHARACTER_DEFINITION_3D_SCHEMA_VERSION) {
            add(NativeDiagnostic("CHARACTER_DEFINITION_SCHEMA", "Unsupported reusable character definition schema version."))
        }
        addAll(NativeCharacterAsset3DValidator.validate(definition.asset))

        val appearance = definition.appearance
        if (!admittedMime.matches(appearance.mimeType)) {
            add(NativeDiagnostic("CHARACTER_DEFINITION_APPEARANCE_MIME", "Reusable character appearance requires an admitted image MIME type."))
        }
        if (appearance.width !in 1..NATIVE_CHARACTER_DEFINITION_3D_MAX_DIMENSION || appearance.height !in 1..NATIVE_CHARACTER_DEFINITION_3D_MAX_DIMENSION) {
            add(NativeDiagnostic("CHARACTER_DEFINITION_APPEARANCE_DIMENSIONS", "Reusable character appearance has invalid bounded dimensions."))
        }
        if (appearance.referenceBytes.size !in 1..NATIVE_CHARACTER_DEFINITION_3D_MAX_REFERENCE_BYTES) {
            add(NativeDiagnostic("CHARACTER_DEFINITION_APPEARANCE_SIZE", "Reusable character appearance has an invalid bounded byte size."))
        }
        if (!sha256.matches(appearance.referenceSha256)) {
            add(NativeDiagnostic("CHARACTER_DEFINITION_APPEARANCE_SHA", "Reusable character appearance requires a canonical lowercase SHA-256 identity."))
        }
        if (appearance.referenceSha256 != definition.asset.referenceSha256) {
            add(NativeDiagnostic("CHARACTER_DEFINITION_APPEARANCE_CONTINUITY", "Reusable character appearance and 3D asset reference identities differ."))
        }
        if (
            appearance.referenceBytes.isNotEmpty() &&
            sha256HexCharacterDefinition(appearance.referenceBytes) != appearance.referenceSha256
        ) {
            add(NativeDiagnostic("CHARACTER_DEFINITION_APPEARANCE_HASH", "Reusable character appearance bytes do not match their exact SHA-256 identity."))
        }
        if (appearance.referenceBytes.isNotEmpty() && !hasAdmittedImageSignature(appearance.mimeType, appearance.referenceBytes)) {
            add(NativeDiagnostic("CHARACTER_DEFINITION_APPEARANCE_SIGNATURE", "Reusable character appearance bytes do not match the admitted image container signature."))
        }

        val materials = definition.asset.vertices.map { it.material }.toSet()
        val missingMaterials = NativeMaterialSlot3D.values().toSet() - materials
        if (missingMaterials.isNotEmpty()) {
            add(
                NativeDiagnostic(
                    "CHARACTER_DEFINITION_MATERIALS",
                    "Reusable character topology is missing required material regions: ${missingMaterials.sortedBy { it.name }.joinToString()}.",
                ),
            )
        }
        if (definition.asset.vertices.any { vertex ->
                !vertex.uv.u.isFinite() || !vertex.uv.v.isFinite() || vertex.uv.u !in 0.0..1.0 || vertex.uv.v !in 0.0..1.0
            }
        ) {
            add(NativeDiagnostic("CHARACTER_DEFINITION_UV", "Reusable character topology contains invalid UV coordinates."))
        }

        val points = definition.asset.vertices.map { it.bindPosition }
        if (points.isNotEmpty()) {
            val width = points.maxOf { it.x } - points.minOf { it.x }
            val height = points.maxOf { it.y } - points.minOf { it.y }
            val depth = points.maxOf { it.z } - points.minOf { it.z }
            if (!width.isFinite() || !height.isFinite() || !depth.isFinite() || width <= 0.20 || height <= 0.50 || depth <= 0.20) {
                add(NativeDiagnostic("CHARACTER_DEFINITION_PROPORTIONS", "Reusable character mesh does not preserve a valid full 3D body volume."))
            }
        }
    }.distinctBy { it.code to it.message }
}

internal data class NativePersistedCharacterDefinition3D(
    val definition: NativeCharacterDefinition3D,
    val assetPayloadSha256: String,
    val manifestSha256: String,
)

/** Durable bundle store for mesh/rig/skinning plus the exact reference appearance bytes. */
internal class NativeCharacterDefinition3DStore(private val directory: File) {
    private val assetFile = File(directory, NATIVE_CHARACTER_DEFINITION_3D_ASSET_NAME)
    private val referenceFile = File(directory, NATIVE_CHARACTER_DEFINITION_3D_REFERENCE_NAME)
    private val manifestFile = File(directory, NATIVE_CHARACTER_DEFINITION_3D_MANIFEST_NAME)
    private val assetStore = NativeCharacterAsset3DStore(assetFile)

    fun persist(definition: NativeCharacterDefinition3D): NativePersistedCharacterDefinition3D {
        val diagnostics = NativeCharacterDefinition3DValidator.validate(definition)
        require(diagnostics.isEmpty()) { "Reusable character definition failed validation: ${diagnostics.joinToString { it.code }}" }
        directory.mkdirs()
        return try {
            val assetDigest = assetStore.persist(definition.asset)
            writeCharacterDefinitionFileAtomically(referenceFile, definition.appearance.referenceBytes)
            val referenceDigest = sha256HexCharacterDefinition(referenceFile)
            require(referenceDigest == definition.appearance.referenceSha256) { "Persisted character appearance identity changed." }

            val manifest = buildString {
                appendLine("schema_version=${definition.schemaVersion}")
                appendLine("asset_id=${definition.asset.assetId}")
                appendLine("actor_id=${definition.asset.actorId}")
                appendLine("source_commit=${definition.asset.sourceCommit}")
                appendLine("reference_sha256=${definition.appearance.referenceSha256}")
                appendLine("mime_type=${definition.appearance.mimeType}")
                appendLine("width=${definition.appearance.width}")
                appendLine("height=${definition.appearance.height}")
                appendLine("reference_size=${definition.appearance.referenceBytes.size}")
                appendLine("asset_payload_sha256=$assetDigest")
            }.toByteArray(Charsets.UTF_8)
            writeCharacterDefinitionFileAtomically(manifestFile, manifest)
            NativePersistedCharacterDefinition3D(
                definition = definition,
                assetPayloadSha256 = assetDigest,
                manifestSha256 = sha256HexCharacterDefinition(manifest),
            )
        } catch (failure: Exception) {
            clear()
            throw failure
        }
    }

    fun restoreVerified(
        actorId: String,
        referenceSha256: String,
        sourceCommit: String,
    ): NativePersistedCharacterDefinition3D? {
        if (!manifestFile.isFile || !referenceFile.isFile || !assetFile.isFile) return null
        return try {
            val manifestBytes = FileInputStream(manifestFile).use { it.readBytes() }
            val manifest = parseManifest(manifestBytes.toString(Charsets.UTF_8))
            val requiredKeys = setOf(
                "schema_version",
                "asset_id",
                "actor_id",
                "source_commit",
                "reference_sha256",
                "mime_type",
                "width",
                "height",
                "reference_size",
                "asset_payload_sha256",
            )
            require(manifest.keys == requiredKeys) { "Character definition manifest has an unexpected schema." }
            require(manifest.getValue("schema_version").toInt() == NATIVE_CHARACTER_DEFINITION_3D_SCHEMA_VERSION)
            require(manifest.getValue("actor_id") == actorId)
            require(manifest.getValue("reference_sha256") == referenceSha256)
            require(manifest.getValue("source_commit") == sourceCommit)

            val restoredAsset = assetStore.restoreVerified(actorId, referenceSha256, sourceCommit) ?: return clearAndNull()
            require(restoredAsset.asset.assetId == manifest.getValue("asset_id"))
            require(restoredAsset.payloadSha256 == manifest.getValue("asset_payload_sha256"))

            val expectedReferenceSize = manifest.getValue("reference_size").toInt()
            require(expectedReferenceSize in 1..NATIVE_CHARACTER_DEFINITION_3D_MAX_REFERENCE_BYTES)
            require(referenceFile.length() == expectedReferenceSize.toLong())
            val referenceBytes = FileInputStream(referenceFile).use { it.readBytes() }
            require(referenceBytes.size == expectedReferenceSize)
            require(sha256HexCharacterDefinition(referenceBytes) == referenceSha256)

            val definition = NativeCharacterDefinition3D(
                schemaVersion = NATIVE_CHARACTER_DEFINITION_3D_SCHEMA_VERSION,
                asset = restoredAsset.asset,
                appearance = NativeCharacterReferenceAppearance3D(
                    displayName = "${restoredAsset.asset.actorId}-reference",
                    mimeType = manifest.getValue("mime_type"),
                    width = manifest.getValue("width").toInt(),
                    height = manifest.getValue("height").toInt(),
                    referenceSha256 = referenceSha256,
                    referenceBytes = referenceBytes,
                ),
            )
            require(NativeCharacterDefinition3DValidator.validate(definition).isEmpty())
            NativePersistedCharacterDefinition3D(
                definition = definition,
                assetPayloadSha256 = restoredAsset.payloadSha256,
                manifestSha256 = sha256HexCharacterDefinition(manifestBytes),
            )
        } catch (_: Exception) {
            clearAndNull()
        }
    }

    fun clear() {
        assetStore.clear()
        referenceFile.delete()
        manifestFile.delete()
        File(directory, "$NATIVE_CHARACTER_DEFINITION_3D_REFERENCE_NAME.tmp").delete()
        File(directory, "$NATIVE_CHARACTER_DEFINITION_3D_MANIFEST_NAME.tmp").delete()
        if (directory.isDirectory && directory.listFiles()?.isEmpty() == true) directory.delete()
    }

    private fun clearAndNull(): NativePersistedCharacterDefinition3D? {
        clear()
        return null
    }

    private fun parseManifest(text: String): Map<String, String> {
        val entries = text.lineSequence().filter { it.isNotBlank() }.map { line ->
            val separator = line.indexOf('=')
            require(separator > 0) { "Invalid character definition manifest line." }
            line.substring(0, separator) to line.substring(separator + 1)
        }.toList()
        require(entries.map { it.first }.distinct().size == entries.size) { "Duplicate character definition manifest key." }
        return entries.toMap()
    }
}

private fun hasAdmittedImageSignature(mimeType: String, bytes: ByteArray): Boolean = when (mimeType.lowercase()) {
    "image/png" -> bytes.size >= 8 && bytes.copyOfRange(0, 8).contentEquals(
        byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    )
    "image/jpeg", "image/jpg" -> bytes.size >= 3 &&
        bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte()
    "image/webp" -> bytes.size >= 12 &&
        bytes.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" &&
        bytes.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WEBP"
    else -> bytes.isNotEmpty()
}

private fun writeCharacterDefinitionFileAtomically(target: File, bytes: ByteArray) {
    target.parentFile?.mkdirs()
    val temp = File(target.parentFile ?: File("."), "${target.name}.tmp")
    if (temp.exists()) temp.delete()
    try {
        FileOutputStream(temp).use { output ->
            output.write(bytes)
            output.flush()
            output.fd.sync()
        }
        if (target.exists() && !target.delete()) error("Unable to replace persisted character definition file.")
        if (!temp.renameTo(target)) {
            FileInputStream(temp).use { input ->
                FileOutputStream(target).use { output ->
                    input.copyTo(output)
                    output.fd.sync()
                }
            }
            if (!temp.delete()) temp.deleteOnExit()
        }
    } catch (failure: Exception) {
        temp.delete()
        throw failure
    }
}

private fun sha256HexCharacterDefinition(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            if (read == 0) continue
            digest.update(buffer, 0, read)
        }
    }
    return hexCharacterDefinition(digest.digest())
}

private fun sha256HexCharacterDefinition(bytes: ByteArray): String =
    hexCharacterDefinition(MessageDigest.getInstance("SHA-256").digest(bytes))

private fun hexCharacterDefinition(bytes: ByteArray): String = buildString(bytes.size * 2) {
    bytes.forEach { value -> append("%02x".format(value.toInt() and 0xff)) }
}
