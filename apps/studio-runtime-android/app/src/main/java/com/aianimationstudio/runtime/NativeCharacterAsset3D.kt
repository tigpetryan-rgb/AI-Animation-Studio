package com.aianimationstudio.runtime

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

internal const val NATIVE_CHARACTER_ASSET_3D_SCHEMA_VERSION = 1
private const val NATIVE_CHARACTER_ASSET_3D_MAX_FILE_BYTES = 16 * 1024 * 1024
private const val NATIVE_CHARACTER_ASSET_3D_MAX_STRING_BYTES = 16 * 1024
private const val NATIVE_CHARACTER_ASSET_3D_MAX_VERTICES = 200_000
private const val NATIVE_CHARACTER_ASSET_3D_MAX_TRIANGLES = 400_000
private const val NATIVE_CHARACTER_ASSET_3D_MAX_BONES = 256
private val NATIVE_CHARACTER_ASSET_3D_MAGIC = "AISTUDIO-CHARACTER-ASSET-3D".toByteArray(Charsets.US_ASCII)

internal data class NativeCharacterAsset3D(
    val schemaVersion: Int,
    val assetId: String,
    val actorId: String,
    val sourceCommit: String,
    val referenceSha256: String,
    val modelKind: String,
    val skeleton: NativeSkeletonDefinition,
    val vertices: List<NativeMeshVertex3D>,
    val triangles: List<NativeMeshTriangle3D>,
    val bindJoints: Map<NativeSemanticBoneRole, NativeBindJoint3D>,
) {
    val vertexCount: Int get() = vertices.size
    val triangleCount: Int get() = triangles.size

    val depthExtentMeters: Double
        get() {
            val z = vertices.map { it.bindPosition.z }
            return if (z.isEmpty()) 0.0 else z.maxOrNull()!! - z.minOrNull()!!
        }
}

internal data class NativeCharacterAssetInstance3D(
    val asset: NativeCharacterAsset3D,
    val rig: NativeCharacterRig,
    val model: NativeCharacterModel3D,
)

internal sealed interface NativeCharacterAsset3DResult {
    data class Ready(val asset: NativeCharacterAsset3D) : NativeCharacterAsset3DResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeCharacterAsset3DResult
}

internal sealed interface NativeCharacterAssetInstantiation3DResult {
    data class Ready(val instance: NativeCharacterAssetInstance3D) : NativeCharacterAssetInstantiation3DResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeCharacterAssetInstantiation3DResult
}

/**
 * Phase-3 reusable character definition.
 *
 * M58 established a real skinned 3D mesh, but that model was intentionally shot-bound. This asset
 * captures only character identity, topology, UV/material assignment, bind skeleton and skinning.
 * A shot-specific rig/model is reconstructed from it later, allowing one verified character to be
 * saved, reopened and reused without serializing transient performance or camera state.
 */
internal object NativeCharacterAsset3DFactory {
    fun capture(model: NativeCharacterModel3D, rig: NativeCharacterRig): NativeCharacterAsset3DResult {
        val modelDiagnostics = NativeCharacterModel3DValidator.validate(model, rig)
        if (modelDiagnostics.isNotEmpty()) return NativeCharacterAsset3DResult.Rejected(modelDiagnostics)

        val asset = NativeCharacterAsset3D(
            schemaVersion = NATIVE_CHARACTER_ASSET_3D_SCHEMA_VERSION,
            assetId = expectedAssetId(
                actorId = model.actorId,
                referenceSha256 = model.referenceSha256,
                modelKind = model.modelKind,
                vertexCount = model.vertexCount,
                triangleCount = model.triangleCount,
            ),
            actorId = model.actorId,
            sourceCommit = model.sourceCommit,
            referenceSha256 = model.referenceSha256,
            modelKind = model.modelKind,
            skeleton = rig.skeleton,
            vertices = model.vertices,
            triangles = model.triangles,
            bindJoints = model.bindJoints,
        )
        val diagnostics = NativeCharacterAsset3DValidator.validate(asset)
        return if (diagnostics.isEmpty()) {
            NativeCharacterAsset3DResult.Ready(asset)
        } else {
            NativeCharacterAsset3DResult.Rejected(diagnostics)
        }
    }

    fun instantiate(asset: NativeCharacterAsset3D, shotId: String): NativeCharacterAssetInstantiation3DResult {
        val diagnostics = NativeCharacterAsset3DValidator.validate(asset).toMutableList()
        if (shotId.isBlank()) diagnostics += NativeDiagnostic("CHARACTER_ASSET_SHOT_ID", "Character asset instantiation requires a non-empty shot identity.")
        if (diagnostics.isNotEmpty()) return NativeCharacterAssetInstantiation3DResult.Rejected(diagnostics)

        val rig = NativeCharacterRig(
            actorId = asset.actorId,
            shotId = shotId,
            sourceCommit = asset.sourceCommit,
            referenceSha256 = asset.referenceSha256,
            skeleton = asset.skeleton,
        )
        val model = NativeCharacterModel3D(
            actorId = asset.actorId,
            shotId = shotId,
            sourceCommit = asset.sourceCommit,
            referenceSha256 = asset.referenceSha256,
            modelKind = asset.modelKind,
            vertices = asset.vertices,
            triangles = asset.triangles,
            bindJoints = asset.bindJoints,
        )
        val modelDiagnostics = NativeCharacterModel3DValidator.validate(model, rig)
        if (modelDiagnostics.isNotEmpty()) return NativeCharacterAssetInstantiation3DResult.Rejected(modelDiagnostics)

        return NativeCharacterAssetInstantiation3DResult.Ready(
            NativeCharacterAssetInstance3D(asset = asset, rig = rig, model = model),
        )
    }
}

internal object NativeCharacterAsset3DValidator {
    private val sha40 = Regex("^[0-9a-f]{40}$")
    private val sha256 = Regex("^[0-9a-f]{64}$")

    fun validate(asset: NativeCharacterAsset3D): List<NativeDiagnostic> = buildList {
        if (asset.schemaVersion != NATIVE_CHARACTER_ASSET_3D_SCHEMA_VERSION) {
            add(NativeDiagnostic("CHARACTER_ASSET_SCHEMA", "Unsupported reusable 3D character asset schema version."))
        }
        if (asset.actorId.isBlank()) add(NativeDiagnostic("CHARACTER_ASSET_ACTOR", "Reusable 3D character asset requires an actor identity."))
        if (!sha40.matches(asset.sourceCommit)) add(NativeDiagnostic("CHARACTER_ASSET_SOURCE", "Reusable 3D character asset requires the exact 40-character Studio source commit."))
        if (!sha256.matches(asset.referenceSha256)) add(NativeDiagnostic("CHARACTER_ASSET_REFERENCE", "Reusable 3D character asset requires an exact lowercase SHA-256 reference identity."))
        if (asset.modelKind != NATIVE_CHARACTER_MODEL_3D_KIND) add(NativeDiagnostic("CHARACTER_ASSET_MODEL_KIND", "Reusable character asset contains an unrecognized 3D model contract."))
        if (asset.vertices.size !in 64..NATIVE_CHARACTER_ASSET_3D_MAX_VERTICES) add(NativeDiagnostic("CHARACTER_ASSET_VERTEX_COUNT", "Reusable character asset has an invalid bounded vertex count."))
        if (asset.triangles.size !in 64..NATIVE_CHARACTER_ASSET_3D_MAX_TRIANGLES) add(NativeDiagnostic("CHARACTER_ASSET_TRIANGLE_COUNT", "Reusable character asset has an invalid bounded triangle count."))
        if (asset.skeleton.bones.size !in 1..NATIVE_CHARACTER_ASSET_3D_MAX_BONES) add(NativeDiagnostic("CHARACTER_ASSET_BONE_COUNT", "Reusable character asset has an invalid bounded skeleton size."))

        val expectedId = expectedAssetId(
            actorId = asset.actorId,
            referenceSha256 = asset.referenceSha256,
            modelKind = asset.modelKind,
            vertexCount = asset.vertexCount,
            triangleCount = asset.triangleCount,
        )
        if (asset.assetId != expectedId) add(NativeDiagnostic("CHARACTER_ASSET_IDENTITY", "Reusable character asset identity does not match its character/reference/topology identity."))

        val boneIds = asset.skeleton.bones.map { it.id }
        if (boneIds.any { it.isBlank() } || boneIds.distinct().size != boneIds.size) {
            add(NativeDiagnostic("CHARACTER_ASSET_BONE_IDS", "Reusable character asset skeleton contains blank or duplicate bone ids."))
        }
        val knownBoneIds = boneIds.toSet()
        asset.skeleton.bones.forEach { bone ->
            if (bone.parentId == bone.id || (bone.parentId != null && bone.parentId !in knownBoneIds)) {
                add(NativeDiagnostic("CHARACTER_ASSET_BONE_HIERARCHY", "Reusable character asset skeleton contains an invalid parent relationship for ${bone.id}."))
            }
        }
        val semanticRoles = asset.skeleton.bones.mapNotNull { it.semanticRole }
        if (semanticRoles.distinct().size != semanticRoles.size) {
            add(NativeDiagnostic("CHARACTER_ASSET_BONE_SEMANTICS", "Reusable character asset skeleton maps a semantic role more than once."))
        }
        val requiredSemantics = setOf(
            NativeSemanticBoneRole.HIPS,
            NativeSemanticBoneRole.HEAD,
            NativeSemanticBoneRole.LEFT_HAND,
            NativeSemanticBoneRole.RIGHT_HAND,
            NativeSemanticBoneRole.LEFT_FOOT,
            NativeSemanticBoneRole.RIGHT_FOOT,
        )
        val missingSemantics = requiredSemantics - semanticRoles.toSet()
        if (missingSemantics.isNotEmpty()) {
            add(NativeDiagnostic("CHARACTER_ASSET_REQUIRED_SEMANTICS", "Reusable character asset is missing required humanoid semantics: ${missingSemantics.sortedBy { it.name }.joinToString()}"))
        }
        asset.bindJoints.forEach { (role, joint) ->
            if (joint.bone != role) add(NativeDiagnostic("CHARACTER_ASSET_BIND_ROLE", "Reusable character asset bind-joint key does not match its semantic bone role."))
        }

        if (asset.actorId.isNotBlank() && sha40.matches(asset.sourceCommit) && sha256.matches(asset.referenceSha256)) {
            val validationShot = "character-asset-validation"
            val rig = NativeCharacterRig(
                actorId = asset.actorId,
                shotId = validationShot,
                sourceCommit = asset.sourceCommit,
                referenceSha256 = asset.referenceSha256,
                skeleton = asset.skeleton,
            )
            val model = NativeCharacterModel3D(
                actorId = asset.actorId,
                shotId = validationShot,
                sourceCommit = asset.sourceCommit,
                referenceSha256 = asset.referenceSha256,
                modelKind = asset.modelKind,
                vertices = asset.vertices,
                triangles = asset.triangles,
                bindJoints = asset.bindJoints,
            )
            addAll(NativeCharacterModel3DValidator.validate(model, rig))
        }
    }.distinctBy { it.code to it.message }
}

internal data class NativePersistedCharacterAsset3D(
    val asset: NativeCharacterAsset3D,
    val payloadSha256: String,
)

/** Durable, checksummed, fail-closed storage for a reusable Phase-3 character asset. */
internal class NativeCharacterAsset3DStore(private val targetFile: File) {
    fun persist(asset: NativeCharacterAsset3D): String {
        val diagnostics = NativeCharacterAsset3DValidator.validate(asset)
        require(diagnostics.isEmpty()) { "Reusable 3D character asset failed validation: ${diagnostics.joinToString { it.code }}" }
        val payload = encodePayload(asset)
        require(payload.size <= NATIVE_CHARACTER_ASSET_3D_MAX_FILE_BYTES) { "Reusable 3D character asset exceeds bounded persistence size." }
        val digest = sha256Bytes(payload)
        val temp = File(targetFile.parentFile ?: File("."), "${targetFile.name}.tmp")
        targetFile.parentFile?.mkdirs()
        if (temp.exists()) temp.delete()
        try {
            FileOutputStream(temp).use { fileOutput ->
                DataOutputStream(fileOutput).use { output ->
                    output.writeInt(NATIVE_CHARACTER_ASSET_3D_MAGIC.size)
                    output.write(NATIVE_CHARACTER_ASSET_3D_MAGIC)
                    output.writeInt(payload.size)
                    output.write(payload)
                    output.writeInt(digest.size)
                    output.write(digest)
                    output.flush()
                    fileOutput.fd.sync()
                }
            }
            replaceCharacterAssetAtomically(temp, targetFile)
            return hexCharacterAsset(digest)
        } catch (failure: Exception) {
            temp.delete()
            throw failure
        }
    }

    fun restoreVerified(
        actorId: String,
        referenceSha256: String,
        sourceCommit: String,
    ): NativePersistedCharacterAsset3D? {
        if (!targetFile.isFile || targetFile.length() <= 0L || targetFile.length() > NATIVE_CHARACTER_ASSET_3D_MAX_FILE_BYTES.toLong() + 1024L) return null
        return try {
            val fileBytes = FileInputStream(targetFile).use { it.readBytes() }
            val input = DataInputStream(ByteArrayInputStream(fileBytes))
            val magicLength = input.readInt()
            if (magicLength != NATIVE_CHARACTER_ASSET_3D_MAGIC.size) return clearAndNull()
            val magic = ByteArray(magicLength)
            input.readFully(magic)
            if (!magic.contentEquals(NATIVE_CHARACTER_ASSET_3D_MAGIC)) return clearAndNull()
            val payloadLength = input.readInt()
            if (payloadLength <= 0 || payloadLength > NATIVE_CHARACTER_ASSET_3D_MAX_FILE_BYTES) return clearAndNull()
            val payload = ByteArray(payloadLength)
            input.readFully(payload)
            val digestLength = input.readInt()
            if (digestLength != 32) return clearAndNull()
            val expectedDigest = ByteArray(digestLength)
            input.readFully(expectedDigest)
            if (input.read() != -1) return clearAndNull()
            val actualDigest = sha256Bytes(payload)
            if (!actualDigest.contentEquals(expectedDigest)) return clearAndNull()

            val asset = decodePayload(payload)
            if (asset.actorId != actorId || asset.referenceSha256 != referenceSha256 || asset.sourceCommit != sourceCommit) return clearAndNull()
            if (NativeCharacterAsset3DValidator.validate(asset).isNotEmpty()) return clearAndNull()
            NativePersistedCharacterAsset3D(asset, hexCharacterAsset(actualDigest))
        } catch (_: Exception) {
            clearAndNull()
        }
    }

    fun clear() {
        targetFile.delete()
        File(targetFile.parentFile ?: File("."), "${targetFile.name}.tmp").delete()
    }

    private fun clearAndNull(): NativePersistedCharacterAsset3D? {
        clear()
        return null
    }

    private fun encodePayload(asset: NativeCharacterAsset3D): ByteArray {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { output ->
            output.writeInt(asset.schemaVersion)
            writeString(output, asset.assetId)
            writeString(output, asset.actorId)
            writeString(output, asset.sourceCommit)
            writeString(output, asset.referenceSha256)
            writeString(output, asset.modelKind)

            writeString(output, asset.skeleton.id)
            output.writeInt(asset.skeleton.version)
            output.writeInt(asset.skeleton.bones.size)
            asset.skeleton.bones.forEach { bone ->
                writeString(output, bone.id)
                writeNullableString(output, bone.parentId)
                writeNullableString(output, bone.semanticRole?.name)
            }

            output.writeInt(asset.vertices.size)
            asset.vertices.forEach { vertex ->
                writePoint(output, vertex.bindPosition)
                writePoint(output, vertex.bindNormal)
                output.writeDouble(vertex.uv.u)
                output.writeDouble(vertex.uv.v)
                writeString(output, vertex.material.name)
                output.writeInt(vertex.influences.size)
                vertex.influences.forEach { influence ->
                    writeString(output, influence.bone.name)
                    output.writeDouble(influence.weight)
                }
            }

            output.writeInt(asset.triangles.size)
            asset.triangles.forEach { triangle ->
                output.writeInt(triangle.a)
                output.writeInt(triangle.b)
                output.writeInt(triangle.c)
            }

            val joints = asset.bindJoints.entries.sortedBy { it.key.ordinal }
            output.writeInt(joints.size)
            joints.forEach { (role, joint) ->
                writeString(output, role.name)
                writePoint(output, joint.bindPosition)
            }
        }
        return bytes.toByteArray()
    }

    private fun decodePayload(payload: ByteArray): NativeCharacterAsset3D {
        val input = DataInputStream(ByteArrayInputStream(payload))
        val schemaVersion = input.readInt()
        val assetId = readString(input)
        val actorId = readString(input)
        val sourceCommit = readString(input)
        val referenceSha256 = readString(input)
        val modelKind = readString(input)

        val skeletonId = readString(input)
        val skeletonVersion = input.readInt()
        val boneCount = boundedCount(input.readInt(), NATIVE_CHARACTER_ASSET_3D_MAX_BONES, "bone")
        val bones = List(boneCount) {
            NativeBoneDefinition(
                id = readString(input),
                parentId = readNullableString(input),
                semanticRole = readNullableString(input)?.let { enumValue<NativeSemanticBoneRole>(it) },
            )
        }
        val skeleton = NativeSkeletonDefinition(skeletonId, skeletonVersion, bones)

        val vertexCount = boundedCount(input.readInt(), NATIVE_CHARACTER_ASSET_3D_MAX_VERTICES, "vertex")
        val vertices = List(vertexCount) {
            val position = readPoint(input)
            val normal = readPoint(input)
            val uv = NativeUvPoint(input.readDouble(), input.readDouble())
            val material = enumValue<NativeMaterialSlot3D>(readString(input))
            val influenceCount = boundedCount(input.readInt(), 4, "skin influence")
            require(influenceCount >= 1) { "Reusable character asset vertex has no skin influence." }
            val influences = List(influenceCount) {
                NativeSkinInfluence3D(
                    bone = enumValue(readString(input)),
                    weight = input.readDouble(),
                )
            }
            NativeMeshVertex3D(position, normal, uv, material, influences)
        }

        val triangleCount = boundedCount(input.readInt(), NATIVE_CHARACTER_ASSET_3D_MAX_TRIANGLES, "triangle")
        val triangles = List(triangleCount) {
            NativeMeshTriangle3D(input.readInt(), input.readInt(), input.readInt())
        }

        val jointCount = boundedCount(input.readInt(), NATIVE_CHARACTER_ASSET_3D_MAX_BONES, "bind joint")
        val bindJoints = buildMap {
            repeat(jointCount) {
                val role = enumValue<NativeSemanticBoneRole>(readString(input))
                require(role !in this) { "Reusable character asset contains duplicate bind-joint semantics." }
                put(role, NativeBindJoint3D(role, readPoint(input)))
            }
        }
        if (input.read() != -1) error("Unexpected trailing reusable character asset payload data.")

        return NativeCharacterAsset3D(
            schemaVersion = schemaVersion,
            assetId = assetId,
            actorId = actorId,
            sourceCommit = sourceCommit,
            referenceSha256 = referenceSha256,
            modelKind = modelKind,
            skeleton = skeleton,
            vertices = vertices,
            triangles = triangles,
            bindJoints = bindJoints,
        )
    }

    private fun writePoint(output: DataOutputStream, point: NativeStagePoint) {
        output.writeDouble(point.x)
        output.writeDouble(point.y)
        output.writeDouble(point.z)
    }

    private fun readPoint(input: DataInputStream): NativeStagePoint = NativeStagePoint(
        input.readDouble(),
        input.readDouble(),
        input.readDouble(),
    )

    private fun writeString(output: DataOutputStream, value: String) {
        val data = value.toByteArray(Charsets.UTF_8)
        require(data.size <= NATIVE_CHARACTER_ASSET_3D_MAX_STRING_BYTES) { "Reusable character asset string exceeds bounded size." }
        output.writeInt(data.size)
        output.write(data)
    }

    private fun readString(input: DataInputStream): String {
        val length = input.readInt()
        require(length in 0..NATIVE_CHARACTER_ASSET_3D_MAX_STRING_BYTES) { "Reusable character asset contains invalid string length." }
        val data = ByteArray(length)
        input.readFully(data)
        return data.toString(Charsets.UTF_8)
    }

    private fun writeNullableString(output: DataOutputStream, value: String?) {
        output.writeBoolean(value != null)
        if (value != null) writeString(output, value)
    }

    private fun readNullableString(input: DataInputStream): String? = if (input.readBoolean()) readString(input) else null

    private inline fun <reified T : Enum<T>> enumValue(value: String): T = enumValues<T>().firstOrNull { it.name == value }
        ?: error("Reusable character asset contains unknown ${T::class.java.simpleName} value: $value")

    private fun boundedCount(value: Int, max: Int, label: String): Int {
        require(value in 0..max) { "Reusable character asset contains invalid $label count." }
        return value
    }
}

private fun expectedAssetId(
    actorId: String,
    referenceSha256: String,
    modelKind: String,
    vertexCount: Int,
    triangleCount: Int,
): String {
    val identity = "$actorId|$referenceSha256|$modelKind|$vertexCount|$triangleCount"
    return "character3d-${sha256HexCharacterAsset(identity.toByteArray(Charsets.UTF_8)).take(24)}"
}

private fun sha256Bytes(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)
private fun sha256HexCharacterAsset(data: ByteArray): String = hexCharacterAsset(sha256Bytes(data))
private fun hexCharacterAsset(data: ByteArray): String = data.joinToString("") { "%02x".format(it) }

private fun replaceCharacterAssetAtomically(temp: File, target: File) {
    if (target.exists() && !target.delete()) error("Could not replace existing reusable character asset.")
    if (!temp.renameTo(target)) {
        FileInputStream(temp).use { input ->
            FileOutputStream(target).use { output ->
                input.copyTo(output)
                output.fd.sync()
            }
        }
        if (!temp.delete()) temp.deleteOnExit()
    }
}