package com.aianimationstudio.runtime

import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

internal data class NativePhase4MeshSample(
    val timeSeconds: Double,
    val widthMeters: Double,
    val heightMeters: Double,
    val depthMeters: Double,
    val center: NativeStagePoint,
    val finiteVertices: Int,
)

internal data class NativePhase4MeshContinuityReport(
    val samples: List<NativePhase4MeshSample>,
    val diagnostics: List<NativeDiagnostic>,
) {
    val passed: Boolean get() = diagnostics.isEmpty() && samples.isNotEmpty()
}

/**
 * Measurable Phase-4 no-collapse gate over the real Phase-3 skinned mesh.
 *
 * This samples the same canonical root/bone tracks consumed by the production 3D renderer, applies
 * weighted bind-joint deformation to every real mesh vertex, and rejects non-finite, flat, imploded,
 * or explosively large geometry. It is intentionally renderer-independent so the actor-performance
 * contract remains valid while Phase 8 finishes the final native rendering pipeline.
 */
internal object NativePhase4SkinnedMeshContinuityGate {
    fun verify(
        asset: NativeCharacterAsset3D,
        performance: NativeActingPerformance,
    ): NativePhase4MeshContinuityReport {
        val diagnostics = NativeCharacterAsset3DValidator.validate(asset).toMutableList()
        if (performance.actorId != asset.actorId || performance.sourceCommit != asset.sourceCommit) {
            diagnostics += NativeDiagnostic("PHASE4_MESH_IDENTITY", "Phase-4 mesh continuity requires exact reusable character/performance identity.")
        }
        if (!performance.durationSeconds.isFinite() || performance.durationSeconds <= 0.0) {
            diagnostics += NativeDiagnostic("PHASE4_MESH_DURATION", "Phase-4 mesh continuity requires a positive finite performance duration.")
        }
        if (diagnostics.isNotEmpty()) return NativePhase4MeshContinuityReport(emptyList(), diagnostics.distinctBy { it.code to it.message })

        val times = listOf(
            0.0,
            performance.durationSeconds * 0.20,
            performance.durationSeconds * 0.40,
            performance.durationSeconds * 0.60,
            performance.durationSeconds * 0.80,
            performance.durationSeconds,
        )
        val samples = times.map { sample(asset, performance, it) }

        samples.forEach { sample ->
            if (sample.finiteVertices != asset.vertexCount) {
                diagnostics += NativeDiagnostic("PHASE4_MESH_NONFINITE", "Skinned Phase-4 mesh contains non-finite vertices at ${sample.timeSeconds}s.")
            }
            if (sample.widthMeters < 0.30 || sample.heightMeters < 0.70 || sample.depthMeters < 0.16) {
                diagnostics += NativeDiagnostic("PHASE4_MESH_COLLAPSE", "Skinned Phase-4 mesh collapsed below minimum 3D body volume at ${sample.timeSeconds}s.")
            }
            if (sample.widthMeters > 4.0 || sample.heightMeters > 4.0 || sample.depthMeters > 4.0) {
                diagnostics += NativeDiagnostic("PHASE4_MESH_EXPLOSION", "Skinned Phase-4 mesh exceeded bounded body volume at ${sample.timeSeconds}s.")
            }
        }
        samples.zipWithNext().forEach { (left, right) ->
            val centerTravel = distance(left.center, right.center)
            if (!centerTravel.isFinite() || centerTravel > 1.5) {
                diagnostics += NativeDiagnostic("PHASE4_MESH_DISCONTINUITY", "Skinned Phase-4 actor teleported or became discontinuous between sampled poses.")
            }
            val widthRatio = ratio(left.widthMeters, right.widthMeters)
            val heightRatio = ratio(left.heightMeters, right.heightMeters)
            val depthRatio = ratio(left.depthMeters, right.depthMeters)
            if (max(widthRatio, max(heightRatio, depthRatio)) > 2.4) {
                diagnostics += NativeDiagnostic("PHASE4_MESH_VOLUME_JUMP", "Skinned Phase-4 body volume changed discontinuously between sampled poses.")
            }
        }

        return NativePhase4MeshContinuityReport(samples, diagnostics.distinctBy { it.code to it.message })
    }

    private fun sample(
        asset: NativeCharacterAsset3D,
        performance: NativeActingPerformance,
        timeSeconds: Double,
    ): NativePhase4MeshSample {
        val root = sampleRoot(performance, timeSeconds)
        val points = asset.vertices.map { vertex -> skinVertex(vertex, asset, performance, root, timeSeconds) }
        val finite = points.filter(::finite)
        if (finite.isEmpty()) {
            return NativePhase4MeshSample(timeSeconds, 0.0, 0.0, 0.0, NativeStagePoint(Double.NaN, Double.NaN, Double.NaN), 0)
        }
        val minX = finite.minOf { it.x }
        val maxX = finite.maxOf { it.x }
        val minY = finite.minOf { it.y }
        val maxY = finite.maxOf { it.y }
        val minZ = finite.minOf { it.z }
        val maxZ = finite.maxOf { it.z }
        return NativePhase4MeshSample(
            timeSeconds = timeSeconds,
            widthMeters = maxX - minX,
            heightMeters = maxY - minY,
            depthMeters = maxZ - minZ,
            center = NativeStagePoint((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5),
            finiteVertices = finite.size,
        )
    }

    private fun skinVertex(
        vertex: NativeMeshVertex3D,
        asset: NativeCharacterAsset3D,
        performance: NativeActingPerformance,
        root: NativeStagePoint,
        timeSeconds: Double,
    ): NativeStagePoint {
        var x = 0.0
        var y = 0.0
        var z = 0.0
        vertex.influences.forEach { influence ->
            val pivot = asset.bindJoints[influence.bone]?.bindPosition ?: NativeStagePoint(0.0, 0.0, 0.0)
            val rotation = sampleBoneRotation(performance, influence.bone, timeSeconds)
            val local = subtract(vertex.bindPosition, pivot)
            val rotated = rotateEuler(local, rotation)
            val world = add(add(pivot, rotated), root)
            x += world.x * influence.weight
            y += world.y * influence.weight
            z += world.z * influence.weight
        }
        return NativeStagePoint(x, y, z)
    }

    private fun sampleRoot(performance: NativeActingPerformance, timeSeconds: Double): NativeStagePoint {
        val track = performance.tracks.firstOrNull { it.kind == NativePerformanceTrackKind.ROOT }
            ?: return NativeStagePoint(0.0, 0.0, 0.0)
        return sampleTrack(track, timeSeconds).rootPosition
    }

    private fun sampleBoneRotation(
        performance: NativeActingPerformance,
        role: NativeSemanticBoneRole,
        timeSeconds: Double,
    ): NativeEulerDegrees {
        performance.tracks.forEach { track ->
            sampleTrack(track, timeSeconds).rotations[role]?.let { return it }
        }
        return NativeEulerDegrees()
    }

    private fun sampleTrack(track: NativePerformanceTrack, timeSeconds: Double): NativePerformancePoseKeyframe {
        val first = track.keyframes.first()
        val last = track.keyframes.last()
        if (timeSeconds <= first.timeSeconds) return first.copy(timeSeconds = timeSeconds)
        if (timeSeconds >= last.timeSeconds) return last.copy(timeSeconds = timeSeconds)
        for (index in 1 until track.keyframes.size) {
            val right = track.keyframes[index]
            val left = track.keyframes[index - 1]
            if (timeSeconds > right.timeSeconds) continue
            val span = right.timeSeconds - left.timeSeconds
            val amount = if (span <= 0.0) 0.0 else (timeSeconds - left.timeSeconds) / span
            val roles = left.rotations.keys + right.rotations.keys
            return NativePerformancePoseKeyframe(
                timeSeconds = timeSeconds,
                rootPosition = lerp(left.rootPosition, right.rootPosition, amount),
                rotations = roles.associateWith { role ->
                    val from = left.rotations[role] ?: NativeEulerDegrees()
                    val to = right.rotations[role] ?: NativeEulerDegrees()
                    NativeEulerDegrees(
                        lerp(from.x, to.x, amount),
                        lerp(from.y, to.y, amount),
                        lerp(from.z, to.z, amount),
                    )
                },
            )
        }
        return last.copy(timeSeconds = timeSeconds)
    }

    private fun rotateEuler(point: NativeStagePoint, rotation: NativeEulerDegrees): NativeStagePoint {
        val rx = Math.toRadians(rotation.x)
        val ry = Math.toRadians(rotation.y)
        val rz = Math.toRadians(rotation.z)
        val cx = cos(rx)
        val sx = sin(rx)
        val x1 = point.x
        val y1 = point.y * cx - point.z * sx
        val z1 = point.y * sx + point.z * cx
        val cy = cos(ry)
        val sy = sin(ry)
        val x2 = x1 * cy + z1 * sy
        val y2 = y1
        val z2 = -x1 * sy + z1 * cy
        val cz = cos(rz)
        val sz = sin(rz)
        return NativeStagePoint(
            x = x2 * cz - y2 * sz,
            y = x2 * sz + y2 * cz,
            z = z2,
        )
    }

    private fun ratio(left: Double, right: Double): Double {
        val small = min(left, right)
        val large = max(left, right)
        return if (small <= 1e-9) Double.POSITIVE_INFINITY else large / small
    }

    private fun distance(left: NativeStagePoint, right: NativeStagePoint): Double {
        val dx = right.x - left.x
        val dy = right.y - left.y
        val dz = right.z - left.z
        return sqrt(dx * dx + dy * dy + dz * dz)
    }

    private fun finite(point: NativeStagePoint): Boolean = point.x.isFinite() && point.y.isFinite() && point.z.isFinite()
    private fun lerp(left: Double, right: Double, amount: Double): Double = left + (right - left) * amount
    private fun lerp(left: NativeStagePoint, right: NativeStagePoint, amount: Double) = NativeStagePoint(
        lerp(left.x, right.x, amount),
        lerp(left.y, right.y, amount),
        lerp(left.z, right.z, amount),
    )
    private fun add(left: NativeStagePoint, right: NativeStagePoint) = NativeStagePoint(left.x + right.x, left.y + right.y, left.z + right.z)
    private fun subtract(left: NativeStagePoint, right: NativeStagePoint) = NativeStagePoint(left.x - right.x, left.y - right.y, left.z - right.z)
}
