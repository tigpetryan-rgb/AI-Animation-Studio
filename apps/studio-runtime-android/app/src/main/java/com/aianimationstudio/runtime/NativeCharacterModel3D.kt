package com.aianimationstudio.runtime

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

internal const val NATIVE_CHARACTER_MODEL_3D_KIND = "AISTUDIO_REFERENCE_BOUND_SKINNED_MESH_V1"

internal data class NativeUvPoint(val u: Double, val v: Double)

internal enum class NativeMaterialSlot3D {
    BODY,
    FACE,
    EYE,
    ACCENT,
}

internal data class NativeSkinInfluence3D(
    val bone: NativeSemanticBoneRole,
    val weight: Double,
)

internal data class NativeMeshVertex3D(
    val bindPosition: NativeStagePoint,
    val bindNormal: NativeStagePoint,
    val uv: NativeUvPoint,
    val material: NativeMaterialSlot3D,
    val influences: List<NativeSkinInfluence3D>,
)

internal data class NativeMeshTriangle3D(
    val a: Int,
    val b: Int,
    val c: Int,
)

internal data class NativeBindJoint3D(
    val bone: NativeSemanticBoneRole,
    val bindPosition: NativeStagePoint,
)

internal data class NativeCharacterModel3D(
    val actorId: String,
    val shotId: String,
    val sourceCommit: String,
    val referenceSha256: String,
    val modelKind: String,
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

internal sealed interface NativeCharacterModel3DResult {
    data class Ready(val model: NativeCharacterModel3D) : NativeCharacterModel3DResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeCharacterModel3DResult
}

/**
 * Creates a real closed 3D triangle mesh with bind joints and per-vertex skin weights.
 *
 * The current implementation is intentionally deterministic and source-bound: it establishes the
 * real mesh/skeleton/skinning contract that the old 2D cutout renderer did not have. Geometry is a
 * bounded stylized reconstruction proxy, not a claim of photogrammetric shape recovery. A later
 * multi-view reconstruction backend can replace only this builder while keeping the model contract,
 * skinning, animation, renderer and exporter unchanged.
 */
internal object NativeCharacterModel3DBuilder {
    private const val LATITUDE_SEGMENTS = 8
    private const val LONGITUDE_SEGMENTS = 12

    fun build(blocking: NativeSceneBlocking, rig: NativeCharacterRig): NativeCharacterModel3DResult {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        if (blocking.actorId != rig.actorId) {
            diagnostics += NativeDiagnostic("MODEL3D_ACTOR_IDENTITY", "3D model actor identity does not match the prepared rig.")
        }
        if (blocking.reference.sha256 != rig.referenceSha256) {
            diagnostics += NativeDiagnostic("MODEL3D_REFERENCE_IDENTITY", "3D model reference identity does not match the prepared rig.")
        }
        if (!Regex("^[0-9a-f]{40}$").matches(rig.sourceCommit)) {
            diagnostics += NativeDiagnostic("MODEL3D_SOURCE_IDENTITY", "3D model creation requires the exact 40-character Studio source commit.")
        }
        val availableBones = rig.skeleton.bones.mapNotNull { it.semanticRole }.toSet()
        val requiredBones = setOf(
            NativeSemanticBoneRole.HIPS,
            NativeSemanticBoneRole.SPINE,
            NativeSemanticBoneRole.HEAD,
            NativeSemanticBoneRole.LEFT_HAND,
            NativeSemanticBoneRole.RIGHT_HAND,
            NativeSemanticBoneRole.LEFT_FOOT,
            NativeSemanticBoneRole.RIGHT_FOOT,
        )
        val missing = requiredBones - availableBones
        if (missing.isNotEmpty()) {
            diagnostics += NativeDiagnostic("MODEL3D_RIG_SEMANTICS", "3D model creation is missing required semantic bones: ${missing.sortedBy { it.name }.joinToString()}.")
        }
        if (diagnostics.isNotEmpty()) return NativeCharacterModel3DResult.Rejected(diagnostics)

        val vertices = mutableListOf<NativeMeshVertex3D>()
        val triangles = mutableListOf<NativeMeshTriangle3D>()

        fun addEllipsoid(
            center: NativeStagePoint,
            radii: NativeStagePoint,
            bone: NativeSemanticBoneRole,
            material: NativeMaterialSlot3D,
            yawDegrees: Double = 0.0,
        ) {
            val base = vertices.size
            val yaw = Math.toRadians(yawDegrees)
            val cosYaw = cos(yaw)
            val sinYaw = sin(yaw)
            for (lat in 0..LATITUDE_SEGMENTS) {
                val v = lat.toDouble() / LATITUDE_SEGMENTS.toDouble()
                val theta = PI * v
                val sinTheta = sin(theta)
                val cosTheta = cos(theta)
                for (lon in 0..LONGITUDE_SEGMENTS) {
                    val u = lon.toDouble() / LONGITUDE_SEGMENTS.toDouble()
                    val phi = 2.0 * PI * u
                    val x0 = radii.x * sinTheta * cos(phi)
                    val y0 = radii.y * cosTheta
                    val z0 = radii.z * sinTheta * sin(phi)
                    val x = x0 * cosYaw + z0 * sinYaw
                    val z = -x0 * sinYaw + z0 * cosYaw

                    val nx0 = if (radii.x == 0.0) 0.0 else x0 / (radii.x * radii.x)
                    val ny0 = if (radii.y == 0.0) 0.0 else y0 / (radii.y * radii.y)
                    val nz0 = if (radii.z == 0.0) 0.0 else z0 / (radii.z * radii.z)
                    val nx = nx0 * cosYaw + nz0 * sinYaw
                    val nz = -nx0 * sinYaw + nz0 * cosYaw
                    val normal = normalize3(NativeStagePoint(nx, ny0, nz))

                    vertices += NativeMeshVertex3D(
                        bindPosition = NativeStagePoint(center.x + x, center.y + y0, center.z + z),
                        bindNormal = normal,
                        uv = NativeUvPoint(u, v),
                        material = material,
                        influences = listOf(NativeSkinInfluence3D(bone, 1.0)),
                    )
                }
            }
            val row = LONGITUDE_SEGMENTS + 1
            for (lat in 0 until LATITUDE_SEGMENTS) {
                for (lon in 0 until LONGITUDE_SEGMENTS) {
                    val a = base + lat * row + lon
                    val b = a + row
                    val c = a + 1
                    val d = b + 1
                    triangles += NativeMeshTriangle3D(a, b, c)
                    triangles += NativeMeshTriangle3D(c, b, d)
                }
            }
        }

        // Rounded stylized creature proportions. These are real closed volumes with measurable Z
        // depth, rather than a textured rectangle pretending to be a rigged character.
        addEllipsoid(
            center = NativeStagePoint(0.0, 0.86, 0.0),
            radii = NativeStagePoint(0.46, 0.60, 0.34),
            bone = NativeSemanticBoneRole.SPINE,
            material = NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            center = NativeStagePoint(0.0, 1.47, 0.0),
            radii = NativeStagePoint(0.54, 0.46, 0.40),
            bone = NativeSemanticBoneRole.HEAD,
            material = NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            center = NativeStagePoint(0.0, 1.46, 0.365),
            radii = NativeStagePoint(0.37, 0.30, 0.055),
            bone = NativeSemanticBoneRole.HEAD,
            material = NativeMaterialSlot3D.FACE,
        )
        addEllipsoid(
            center = NativeStagePoint(-0.17, 1.51, 0.417),
            radii = NativeStagePoint(0.075, 0.105, 0.040),
            bone = NativeSemanticBoneRole.HEAD,
            material = NativeMaterialSlot3D.EYE,
        )
        addEllipsoid(
            center = NativeStagePoint(0.17, 1.51, 0.417),
            radii = NativeStagePoint(0.075, 0.105, 0.040),
            bone = NativeSemanticBoneRole.HEAD,
            material = NativeMaterialSlot3D.EYE,
        )
        addEllipsoid(
            center = NativeStagePoint(-0.54, 1.46, 0.0),
            radii = NativeStagePoint(0.17, 0.28, 0.16),
            bone = NativeSemanticBoneRole.HEAD,
            material = NativeMaterialSlot3D.BODY,
            yawDegrees = -8.0,
        )
        addEllipsoid(
            center = NativeStagePoint(0.54, 1.46, 0.0),
            radii = NativeStagePoint(0.17, 0.28, 0.16),
            bone = NativeSemanticBoneRole.HEAD,
            material = NativeMaterialSlot3D.BODY,
            yawDegrees = 8.0,
        )

        addEllipsoid(
            center = NativeStagePoint(-0.52, 0.88, 0.0),
            radii = NativeStagePoint(0.15, 0.34, 0.15),
            bone = NativeSemanticBoneRole.LEFT_UPPER_ARM,
            material = NativeMaterialSlot3D.BODY,
            yawDegrees = -12.0,
        )
        addEllipsoid(
            center = NativeStagePoint(0.52, 0.88, 0.0),
            radii = NativeStagePoint(0.15, 0.34, 0.15),
            bone = NativeSemanticBoneRole.RIGHT_UPPER_ARM,
            material = NativeMaterialSlot3D.BODY,
            yawDegrees = 12.0,
        )
        addEllipsoid(
            center = NativeStagePoint(-0.56, 0.58, 0.02),
            radii = NativeStagePoint(0.16, 0.18, 0.15),
            bone = NativeSemanticBoneRole.LEFT_HAND,
            material = NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            center = NativeStagePoint(0.56, 0.58, 0.02),
            radii = NativeStagePoint(0.16, 0.18, 0.15),
            bone = NativeSemanticBoneRole.RIGHT_HAND,
            material = NativeMaterialSlot3D.BODY,
        )

        addEllipsoid(
            center = NativeStagePoint(-0.22, 0.30, 0.0),
            radii = NativeStagePoint(0.18, 0.31, 0.18),
            bone = NativeSemanticBoneRole.LEFT_UPPER_LEG,
            material = NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            center = NativeStagePoint(0.22, 0.30, 0.0),
            radii = NativeStagePoint(0.18, 0.31, 0.18),
            bone = NativeSemanticBoneRole.RIGHT_UPPER_LEG,
            material = NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            center = NativeStagePoint(-0.22, 0.08, 0.08),
            radii = NativeStagePoint(0.23, 0.12, 0.27),
            bone = NativeSemanticBoneRole.LEFT_FOOT,
            material = NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            center = NativeStagePoint(0.22, 0.08, 0.08),
            radii = NativeStagePoint(0.23, 0.12, 0.27),
            bone = NativeSemanticBoneRole.RIGHT_FOOT,
            material = NativeMaterialSlot3D.BODY,
        )

        // Front accent volume gives a visible depth cue when the camera or character rotates.
        addEllipsoid(
            center = NativeStagePoint(0.0, 0.82, 0.355),
            radii = NativeStagePoint(0.13, 0.13, 0.045),
            bone = NativeSemanticBoneRole.CHEST,
            material = NativeMaterialSlot3D.ACCENT,
        )

        val bindJoints = buildMap {
            fun joint(role: NativeSemanticBoneRole, x: Double, y: Double, z: Double = 0.0) {
                if (role in availableBones) put(role, NativeBindJoint3D(role, NativeStagePoint(x, y, z)))
            }
            joint(NativeSemanticBoneRole.HIPS, 0.0, 0.72)
            joint(NativeSemanticBoneRole.SPINE, 0.0, 0.98)
            joint(NativeSemanticBoneRole.CHEST, 0.0, 1.18)
            joint(NativeSemanticBoneRole.NECK, 0.0, 1.28)
            joint(NativeSemanticBoneRole.HEAD, 0.0, 1.47)
            joint(NativeSemanticBoneRole.LEFT_SHOULDER, -0.37, 1.14)
            joint(NativeSemanticBoneRole.LEFT_UPPER_ARM, -0.49, 0.99)
            joint(NativeSemanticBoneRole.LEFT_LOWER_ARM, -0.55, 0.76)
            joint(NativeSemanticBoneRole.LEFT_HAND, -0.56, 0.58)
            joint(NativeSemanticBoneRole.RIGHT_SHOULDER, 0.37, 1.14)
            joint(NativeSemanticBoneRole.RIGHT_UPPER_ARM, 0.49, 0.99)
            joint(NativeSemanticBoneRole.RIGHT_LOWER_ARM, 0.55, 0.76)
            joint(NativeSemanticBoneRole.RIGHT_HAND, 0.56, 0.58)
            joint(NativeSemanticBoneRole.LEFT_UPPER_LEG, -0.22, 0.48)
            joint(NativeSemanticBoneRole.LEFT_LOWER_LEG, -0.22, 0.25)
            joint(NativeSemanticBoneRole.LEFT_FOOT, -0.22, 0.08, 0.08)
            joint(NativeSemanticBoneRole.RIGHT_UPPER_LEG, 0.22, 0.48)
            joint(NativeSemanticBoneRole.RIGHT_LOWER_LEG, 0.22, 0.25)
            joint(NativeSemanticBoneRole.RIGHT_FOOT, 0.22, 0.08, 0.08)
        }

        val model = NativeCharacterModel3D(
            actorId = blocking.actorId,
            shotId = rig.shotId,
            sourceCommit = rig.sourceCommit,
            referenceSha256 = rig.referenceSha256,
            modelKind = NATIVE_CHARACTER_MODEL_3D_KIND,
            vertices = vertices,
            triangles = triangles,
            bindJoints = bindJoints,
        )
        val validation = NativeCharacterModel3DValidator.validate(model, rig)
        return if (validation.isEmpty()) {
            NativeCharacterModel3DResult.Ready(model)
        } else {
            NativeCharacterModel3DResult.Rejected(validation)
        }
    }
}

internal object NativeCharacterModel3DValidator {
    fun validate(model: NativeCharacterModel3D, rig: NativeCharacterRig): List<NativeDiagnostic> = buildList {
        if (model.actorId != rig.actorId || model.shotId != rig.shotId) {
            add(NativeDiagnostic("MODEL3D_CONTINUITY", "3D model actor/shot identity does not match the rig."))
        }
        if (model.sourceCommit != rig.sourceCommit || model.referenceSha256 != rig.referenceSha256) {
            add(NativeDiagnostic("MODEL3D_SOURCE_CONTINUITY", "3D model source/reference identity does not match the rig."))
        }
        if (model.modelKind != NATIVE_CHARACTER_MODEL_3D_KIND) {
            add(NativeDiagnostic("MODEL3D_KIND", "3D model kind is not the admitted native skinned-mesh contract."))
        }
        if (model.vertices.size < 64) add(NativeDiagnostic("MODEL3D_VERTEX_COUNT", "3D model requires a non-trivial triangle mesh."))
        if (model.triangles.size < 64) add(NativeDiagnostic("MODEL3D_TRIANGLE_COUNT", "3D model requires a non-trivial triangle surface."))
        if (model.depthExtentMeters < 0.25) add(NativeDiagnostic("MODEL3D_DEPTH", "3D model must contain real measurable Z-depth; a flat card is rejected."))

        val knownBones = rig.skeleton.bones.mapNotNull { it.semanticRole }.toSet()
        model.vertices.forEachIndexed { index, vertex ->
            if (!finite3(vertex.bindPosition) || !finite3(vertex.bindNormal)) {
                add(NativeDiagnostic("MODEL3D_NONFINITE_VERTEX", "3D model vertex $index contains a non-finite position/normal."))
                return@forEachIndexed
            }
            if (vertex.uv.u !in 0.0..1.0 || vertex.uv.v !in 0.0..1.0) {
                add(NativeDiagnostic("MODEL3D_UV_RANGE", "3D model vertex $index contains out-of-range UV coordinates."))
            }
            if (vertex.influences.isEmpty() || vertex.influences.size > 4) {
                add(NativeDiagnostic("MODEL3D_SKIN_INFLUENCES", "3D model vertex $index must have between one and four skin influences."))
            } else {
                val total = vertex.influences.sumOf { it.weight }
                if (abs(total - 1.0) > 1e-6 || vertex.influences.any { !it.weight.isFinite() || it.weight <= 0.0 || it.bone !in knownBones }) {
                    add(NativeDiagnostic("MODEL3D_SKIN_WEIGHTS", "3D model vertex $index contains invalid skin weights or unknown bones."))
                }
            }
        }
        model.triangles.forEachIndexed { index, triangle ->
            val ids = listOf(triangle.a, triangle.b, triangle.c)
            if (ids.any { it !in model.vertices.indices } || ids.toSet().size != 3) {
                add(NativeDiagnostic("MODEL3D_TRIANGLE_INDEX", "3D model triangle $index contains invalid or duplicate vertex indices."))
            }
        }
        val requiredJoints = setOf(
            NativeSemanticBoneRole.HIPS,
            NativeSemanticBoneRole.HEAD,
            NativeSemanticBoneRole.LEFT_HAND,
            NativeSemanticBoneRole.RIGHT_HAND,
            NativeSemanticBoneRole.LEFT_FOOT,
            NativeSemanticBoneRole.RIGHT_FOOT,
        )
        val missingJoints = requiredJoints - model.bindJoints.keys
        if (missingJoints.isNotEmpty()) {
            add(NativeDiagnostic("MODEL3D_BIND_JOINTS", "3D model is missing required bind joints: ${missingJoints.sortedBy { it.name }.joinToString()}.") )
        }
    }
}

private fun finite3(point: NativeStagePoint): Boolean = point.x.isFinite() && point.y.isFinite() && point.z.isFinite()

private fun normalize3(value: NativeStagePoint): NativeStagePoint {
    val length = sqrt(value.x * value.x + value.y * value.y + value.z * value.z)
    if (!length.isFinite() || length <= 1e-12) return NativeStagePoint(0.0, 1.0, 0.0)
    return NativeStagePoint(value.x / length, value.y / length, value.z / length)
}
