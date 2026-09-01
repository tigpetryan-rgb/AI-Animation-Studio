package com.aianimationstudio.runtime

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Locale

private const val M57_PLAN_FILE_VERSION = 1
private const val M57_MAX_PLAN_FILE_BYTES = 512 * 1024
private const val M57_MAX_PLAN_STRING_BYTES = M57_MAX_SCRIPT_BYTES * 4
private val M57_PLAN_MAGIC = "AISTUDIO-M57-PLAN".toByteArray(Charsets.US_ASCII)

internal data class NativePersistedScenePlan(
    val ir: NativeSceneIrV1,
    val timeline: NativeSceneTimelinePlan,
    val payloadSha256: String,
)

/**
 * Durable compiled-plan store. A plan is accepted on reload only when its raw script hash, exact
 * reference SHA-256 and exact source commit all match the caller's current identity. The payload is
 * itself SHA-256 protected and the timeline is recompiled from stored shots before reuse.
 */
internal class NativeScenePlanStore(private val targetFile: File) {
    fun persist(ir: NativeSceneIrV1, timeline: NativeSceneTimelinePlan): String {
        validatePlanIdentity(ir, timeline)
        val payload = encodePayload(ir, timeline)
        require(payload.size <= M57_MAX_PLAN_FILE_BYTES) { "Compiled M57 scene plan exceeds bounded persistence size." }
        val digest = sha256Bytes(payload)
        val temp = File(targetFile.parentFile ?: File("."), "${targetFile.name}.tmp")
        targetFile.parentFile?.mkdirs()
        if (temp.exists()) temp.delete()
        try {
            FileOutputStream(temp).use { fileOutput ->
                DataOutputStream(fileOutput).use { output ->
                    output.writeInt(M57_PLAN_MAGIC.size)
                    output.write(M57_PLAN_MAGIC)
                    output.writeInt(payload.size)
                    output.write(payload)
                    output.writeInt(digest.size)
                    output.write(digest)
                    output.flush()
                    fileOutput.fd.sync()
                }
            }
            replaceAtomically(temp, targetFile)
            return hex(digest)
        } catch (failure: Exception) {
            temp.delete()
            throw failure
        }
    }

    fun restoreVerified(
        script: String,
        referenceSha256: String,
        sourceCommit: String,
    ): NativePersistedScenePlan? {
        if (!targetFile.isFile || targetFile.length() <= 0L || targetFile.length() > M57_MAX_PLAN_FILE_BYTES.toLong() + 1024L) return null
        return try {
            val fileBytes = FileInputStream(targetFile).use { it.readBytes() }
            val input = DataInputStream(ByteArrayInputStream(fileBytes))
            val magicLength = input.readInt()
            if (magicLength != M57_PLAN_MAGIC.size) return clearAndNull()
            val magic = ByteArray(magicLength)
            input.readFully(magic)
            if (!magic.contentEquals(M57_PLAN_MAGIC)) return clearAndNull()
            val payloadLength = input.readInt()
            if (payloadLength <= 0 || payloadLength > M57_MAX_PLAN_FILE_BYTES) return clearAndNull()
            val payload = ByteArray(payloadLength)
            input.readFully(payload)
            val digestLength = input.readInt()
            if (digestLength != 32) return clearAndNull()
            val expectedDigest = ByteArray(digestLength)
            input.readFully(expectedDigest)
            if (input.read() != -1) return clearAndNull()
            val actualDigest = sha256Bytes(payload)
            if (!actualDigest.contentEquals(expectedDigest)) return clearAndNull()

            val decoded = decodePayload(payload)
            if (decoded.ir.originalText != script) return clearAndNull()
            if (decoded.ir.scriptSha256 != NativeSceneCompilerSecurity.sha256(script)) return clearAndNull()
            if (decoded.ir.referenceSha256 != referenceSha256 || decoded.timeline.referenceSha256 != referenceSha256) return clearAndNull()
            if (decoded.ir.sourceCommit != sourceCommit || decoded.timeline.sourceCommit != sourceCommit) return clearAndNull()
            if (decoded.timeline.scriptSha256 != decoded.ir.scriptSha256) return clearAndNull()
            validatePlanIdentity(decoded.ir, decoded.timeline)
            decoded.copy(payloadSha256 = hex(actualDigest))
        } catch (_: Exception) {
            clearAndNull()
        }
    }

    fun clear() {
        targetFile.delete()
        File(targetFile.parentFile ?: File("."), "${targetFile.name}.tmp").delete()
    }

    private fun validatePlanIdentity(ir: NativeSceneIrV1, timeline: NativeSceneTimelinePlan) {
        require(ir.schemaVersion == M57_SCENE_IR_SCHEMA_VERSION) { "Only M57 Scene IR v1 can be persisted." }
        require(ir.scriptSha256 == NativeSceneCompilerSecurity.sha256(ir.originalText)) { "Scene IR script hash does not match original text." }
        require(ir.sourceCommit == timeline.sourceCommit) { "Scene IR/timeline source commit mismatch." }
        require(ir.referenceSha256 == timeline.referenceSha256) { "Scene IR/timeline reference SHA mismatch." }
        require(ir.scriptSha256 == timeline.scriptSha256) { "Scene IR/timeline script SHA mismatch." }
        require(NativeSceneCapabilityRegistry.unsupported(ir.actions).isEmpty()) { "Unsupported Scene IR is never persisted as executable production state." }
        val drafts = timeline.shots.map { shot ->
            NativeSceneShotDraft(
                id = shot.id,
                startSeconds = shot.startSeconds,
                durationSeconds = shot.endSeconds - shot.startSeconds,
                actionIds = shot.actionIds,
                camera = shot.camera,
            )
        }
        val recompiled = NativeSceneTimelineCompiler.compile(ir, drafts)
        require(recompiled is NativeSceneTimelineResult.Ready) { "Persisted timeline failed deterministic revalidation." }
        val verified = recompiled.timeline
        require(verified.sourceCommit == timeline.sourceCommit && verified.referenceSha256 == timeline.referenceSha256 && verified.scriptSha256 == timeline.scriptSha256) {
            "Persisted timeline identity changed during deterministic revalidation."
        }
    }

    private fun encodePayload(ir: NativeSceneIrV1, timeline: NativeSceneTimelinePlan): ByteArray {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { output ->
            output.writeInt(M57_PLAN_FILE_VERSION)
            output.writeInt(ir.schemaVersion)
            writeString(output, ir.detectedLanguage.name)
            writeString(output, ir.originalText)
            writeString(output, ir.normalizedText)
            writeString(output, ir.scriptSha256)
            writeString(output, ir.sourceCommit)
            writeString(output, ir.referenceSha256)
            writeString(output, ir.semanticProvider)
            writeString(output, ir.semanticModel)
            writeString(output, ir.actorId)
            output.writeInt(ir.output.width)
            output.writeInt(ir.output.height)
            output.writeDouble(ir.output.frameRate)
            output.writeDouble(ir.output.durationSeconds)
            output.writeInt(ir.warnings.size)
            ir.warnings.forEach { writeString(output, it) }
            output.writeInt(ir.actions.size)
            ir.actions.forEach { action ->
                writeString(output, action.id)
                writeString(output, action.concept.name)
                writeString(output, action.actorId)
                writeNullableString(output, action.targetId)
                writeNullableString(output, action.text)
                writeNullableDouble(output, action.startSeconds)
                writeNullableDouble(output, action.durationSeconds)
                writeString(output, action.sourceExcerpt)
            }
            writeString(output, timeline.sourceCommit)
            writeString(output, timeline.referenceSha256)
            writeString(output, timeline.scriptSha256)
            output.writeDouble(timeline.durationSeconds)
            output.writeInt(timeline.shots.size)
            timeline.shots.forEach { shot ->
                writeString(output, shot.id)
                output.writeDouble(shot.startSeconds)
                output.writeDouble(shot.endSeconds)
                output.writeInt(shot.actionIds.size)
                shot.actionIds.forEach { writeString(output, it) }
                writeString(output, shot.camera.shotSize.name)
                writeString(output, shot.camera.angle.name)
                writeString(output, shot.camera.movement.name)
                writeString(output, shot.camera.focusTargetId)
            }
        }
        return bytes.toByteArray()
    }

    private fun decodePayload(payload: ByteArray): NativePersistedScenePlan {
        val input = DataInputStream(ByteArrayInputStream(payload))
        val fileVersion = input.readInt()
        require(fileVersion == M57_PLAN_FILE_VERSION) { "Unsupported persisted M57 plan file version." }
        val schemaVersion = input.readInt()
        val language = enumValue<NativeSceneLanguage>(readString(input))
        val originalText = readString(input)
        val normalizedText = readString(input)
        val scriptSha = readString(input)
        val sourceCommit = readString(input)
        val referenceSha = readString(input)
        val provider = readString(input)
        val model = readString(input)
        val actorId = readString(input)
        val output = NativeSceneOutput(
            width = input.readInt(),
            height = input.readInt(),
            frameRate = input.readDouble(),
            durationSeconds = input.readDouble(),
        )
        val warningCount = boundedCount(input.readInt(), 64, "warning")
        val warnings = List(warningCount) { readString(input) }
        val actionCount = boundedCount(input.readInt(), M57_MAX_MODEL_ACTIONS, "action")
        val actions = List(actionCount) {
            NativeSceneAction(
                id = readString(input),
                concept = enumValue(readString(input)),
                actorId = readString(input),
                targetId = readNullableString(input),
                text = readNullableString(input),
                startSeconds = readNullableDouble(input),
                durationSeconds = readNullableDouble(input),
                sourceExcerpt = readString(input),
            )
        }
        val timelineSource = readString(input)
        val timelineReference = readString(input)
        val timelineScript = readString(input)
        val timelineDuration = input.readDouble()
        val shotCount = boundedCount(input.readInt(), M57_MAX_SHOTS, "shot")
        val shots = List(shotCount) {
            val id = readString(input)
            val start = input.readDouble()
            val end = input.readDouble()
            val actionRefCount = boundedCount(input.readInt(), M57_MAX_TIMELINE_EVENTS, "action reference")
            val actionIds = List(actionRefCount) { readString(input) }
            val camera = NativeSceneCameraPlan(
                shotSize = enumValue(readString(input)),
                angle = enumValue(readString(input)),
                movement = enumValue(readString(input)),
                focusTargetId = readString(input),
            )
            NativeSceneShot(id, start, end, actionIds, camera)
        }
        if (input.read() != -1) error("Unexpected trailing persisted M57 scene-plan payload data.")
        val ir = NativeSceneIrV1(
            schemaVersion = schemaVersion,
            detectedLanguage = language,
            originalText = originalText,
            normalizedText = normalizedText,
            scriptSha256 = scriptSha,
            sourceCommit = sourceCommit,
            referenceSha256 = referenceSha,
            semanticProvider = provider,
            semanticModel = model,
            actorId = actorId,
            output = output,
            actions = actions,
            warnings = warnings,
        )
        val timeline = NativeSceneTimelinePlan(
            sourceCommit = timelineSource,
            referenceSha256 = timelineReference,
            scriptSha256 = timelineScript,
            durationSeconds = timelineDuration,
            shots = shots,
        )
        return NativePersistedScenePlan(ir, timeline, payloadSha256 = "")
    }

    private fun writeString(output: DataOutputStream, value: String) {
        val bytes = value.toByteArray(Charsets.UTF_8)
        require(bytes.size <= M57_MAX_PLAN_STRING_BYTES) { "Persisted M57 plan string exceeds bounded size." }
        output.writeInt(bytes.size)
        output.write(bytes)
    }

    private fun readString(input: DataInputStream): String {
        val length = input.readInt()
        require(length in 0..M57_MAX_PLAN_STRING_BYTES) { "Persisted M57 plan contains invalid string length." }
        val bytes = ByteArray(length)
        input.readFully(bytes)
        return bytes.toString(Charsets.UTF_8)
    }

    private fun writeNullableString(output: DataOutputStream, value: String?) {
        output.writeBoolean(value != null)
        if (value != null) writeString(output, value)
    }

    private fun readNullableString(input: DataInputStream): String? = if (input.readBoolean()) readString(input) else null

    private fun writeNullableDouble(output: DataOutputStream, value: Double?) {
        output.writeBoolean(value != null)
        if (value != null) output.writeDouble(value)
    }

    private fun readNullableDouble(input: DataInputStream): Double? = if (input.readBoolean()) input.readDouble() else null

    private fun boundedCount(value: Int, max: Int, label: String): Int {
        require(value in 0..max) { "Persisted M57 plan contains invalid $label count." }
        return value
    }

    private inline fun <reified T : Enum<T>> enumValue(name: String): T = enumValues<T>().firstOrNull { it.name == name }
        ?: error("Persisted M57 plan contains unknown ${T::class.java.simpleName} value '$name'.")

    private fun sha256Bytes(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun hex(bytes: ByteArray): String = buildString(bytes.size * 2) {
        bytes.forEach { append(String.format(Locale.ROOT, "%02x", it.toInt() and 0xff)) }
    }

    private fun replaceAtomically(temp: File, target: File) {
        if (target.exists() && !target.delete()) error("Unable to replace previous persisted M57 scene plan.")
        if (temp.renameTo(target)) return
        FileInputStream(temp).use { input ->
            FileOutputStream(target).use { output ->
                input.copyTo(output)
                output.fd.sync()
            }
        }
        if (!temp.delete()) temp.deleteOnExit()
    }

    private fun clearAndNull(): NativePersistedScenePlan? {
        clear()
        return null
    }
}
