package com.aianimationstudio.runtime

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

internal data class NativeMeshFrameGeometry3D(
    val drawWidth: Double,
    val drawHeight: Double,
    val coveragePixels: Long,
    val visibleTriangles: Int,
    val nearestDepth: Double,
    val farthestDepth: Double,
)

internal data class NativeModelBounds3D(
    val minX: Double,
    val maxX: Double,
    val minY: Double,
    val maxY: Double,
    val minZ: Double,
    val maxZ: Double,
) {
    companion object {
        fun from(model: NativeCharacterModel3D): NativeModelBounds3D {
            val points = model.vertices.map { it.bindPosition }
            require(points.isNotEmpty()) { "3D model has no vertices." }
            return NativeModelBounds3D(
                minX = points.minOf { it.x },
                maxX = points.maxOf { it.x },
                minY = points.minOf { it.y },
                maxY = points.maxOf { it.y },
                minZ = points.minOf { it.z },
                maxZ = points.maxOf { it.z },
            )
        }
    }
}

internal data class NativeReferencePalette3D(
    val body: Int,
    val face: Int,
    val eye: Int,
    val accent: Int,
    private val textureBitmap: Bitmap,
    private val textureViews: List<NativeReferenceViewEvidence3D>,
    private val backgroundColor: Int,
) {
    fun color(material: NativeMaterialSlot3D): Int = when (material) {
        NativeMaterialSlot3D.BODY -> body
        NativeMaterialSlot3D.FACE -> face
        NativeMaterialSlot3D.EYE -> eye
        NativeMaterialSlot3D.ACCENT -> accent
    }

    fun texturedColor(
        material: NativeMaterialSlot3D,
        bindPosition: NativeStagePoint,
        bindNormal: NativeStagePoint,
        bounds: NativeModelBounds3D,
    ): Int {
        val fallback = color(material)
        if (textureViews.isEmpty() || textureBitmap.isRecycled) return fallback

        val absX = abs(bindNormal.x)
        val absZ = abs(bindNormal.z)
        val viewIndex = when {
            absZ >= absX && bindNormal.z < -0.15 && textureViews.size >= 3 -> 2
            absX > absZ && textureViews.size >= 2 -> 1
            else -> 0
        }.coerceIn(0, textureViews.lastIndex)
        val view = textureViews[viewIndex]

        val u = when (viewIndex) {
            1 -> {
                val depth = normalizeAxis(bindPosition.z, bounds.minZ, bounds.maxZ)
                if (bindNormal.x < 0.0) 1.0 - depth else depth
            }
            2 -> 1.0 - normalizeAxis(bindPosition.x, bounds.minX, bounds.maxX)
            else -> normalizeAxis(bindPosition.x, bounds.minX, bounds.maxX)
        }.coerceIn(0.0, 1.0)
        val v = (1.0 - normalizeAxis(bindPosition.y, bounds.minY, bounds.maxY)).coerceIn(0.0, 1.0)

        val xFraction = view.leftFraction + u * view.widthFraction
        val yFraction = view.topFraction + v * view.heightFraction
        val x = (xFraction * textureBitmap.width).roundToInt().coerceIn(0, textureBitmap.width - 1)
        val y = (yFraction * textureBitmap.height).roundToInt().coerceIn(0, textureBitmap.height - 1)
        val sampled = sampleNeighborhood(textureBitmap, x, y)

        if (colorDistance(sampled, backgroundColor) < 42.0) return fallback
        return blend(fallback, sampled, if (material == NativeMaterialSlot3D.BODY) 0.84 else 0.92)
    }

    private fun normalizeAxis(value: Double, minValue: Double, maxValue: Double): Double {
        val span = maxValue - minValue
        return if (!span.isFinite() || span <= 1e-9) 0.5 else (value - minValue) / span
    }

    private fun sampleNeighborhood(bitmap: Bitmap, centerX: Int, centerY: Int): Int {
        var r = 0L
        var g = 0L
        var b = 0L
        var count = 0
        for (dy in -1..1) {
            for (dx in -1..1) {
                val x = (centerX + dx).coerceIn(0, bitmap.width - 1)
                val y = (centerY + dy).coerceIn(0, bitmap.height - 1)
                val pixel = bitmap.getPixel(x, y)
                r += Color.red(pixel)
                g += Color.green(pixel)
                b += Color.blue(pixel)
                count += 1
            }
        }
        return Color.rgb((r / count).toInt(), (g / count).toInt(), (b / count).toInt())
    }

    internal companion object {
        fun fromBitmap(bitmap: Bitmap): NativeReferencePalette3D {
            data class Bucket(var count: Int = 0, var r: Long = 0, var g: Long = 0, var b: Long = 0)

            fun dominant(predicate: (Int, Int, Int, Double, Double) -> Boolean): Int? {
                val buckets = mutableMapOf<Int, Bucket>()
                val step = max(1, min(bitmap.width, bitmap.height) / 96)
                var y = 0
                while (y < bitmap.height) {
                    var x = 0
                    while (x < bitmap.width) {
                        val pixel = bitmap.getPixel(x, y)
                        val r = Color.red(pixel)
                        val g = Color.green(pixel)
                        val b = Color.blue(pixel)
                        val maxChannel = max(r, max(g, b)).toDouble() / 255.0
                        val minChannel = min(r, min(g, b)).toDouble() / 255.0
                        val saturation = if (maxChannel <= 1e-9) 0.0 else (maxChannel - minChannel) / maxChannel
                        val luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
                        if (predicate(r, g, b, saturation, luminance)) {
                            val key = ((r shr 5) shl 6) or ((g shr 5) shl 3) or (b shr 5)
                            val bucket = buckets.getOrPut(key) { Bucket() }
                            bucket.count += 1
                            bucket.r += r
                            bucket.g += g
                            bucket.b += b
                        }
                        x += step
                    }
                    y += step
                }
                val bucket = buckets.maxByOrNull { it.value.count }?.value ?: return null
                if (bucket.count <= 0) return null
                return Color.rgb(
                    (bucket.r / bucket.count).toInt().coerceIn(0, 255),
                    (bucket.g / bucket.count).toInt().coerceIn(0, 255),
                    (bucket.b / bucket.count).toInt().coerceIn(0, 255),
                )
            }

            val body = dominant { _, _, _, saturation, luminance ->
                saturation >= 0.28 && luminance in 0.18..0.88
            } ?: Color.rgb(69, 183, 181)
            val face = dominant { r, _, b, saturation, luminance ->
                luminance >= 0.62 && saturation <= 0.38 && r >= b
            } ?: blend(body, Color.WHITE, 0.68)
            val eye = dominant { _, _, _, _, luminance -> luminance <= 0.16 } ?: Color.rgb(12, 25, 27)
            val accent = dominant { r, g, b, saturation, luminance ->
                saturation >= 0.45 && luminance >= 0.45 && r >= b && g >= b
            } ?: Color.rgb(236, 184, 50)
            val views = runCatching { NativeReferenceShapeAnalyzer3D.analyzeBitmap(bitmap)?.viewEvidence.orEmpty() }
                .getOrDefault(emptyList())
            return NativeReferencePalette3D(
                body = body,
                face = face,
                eye = eye,
                accent = accent,
                textureBitmap = bitmap,
                textureViews = views,
                backgroundColor = averageCorners(bitmap),
            )
        }

        private fun averageCorners(bitmap: Bitmap): Int {
            val points = listOf(
                0 to 0,
                (bitmap.width - 1) to 0,
                0 to (bitmap.height - 1),
                (bitmap.width - 1) to (bitmap.height - 1),
            )
            return Color.rgb(
                points.sumOf { (x, y) -> Color.red(bitmap.getPixel(x, y)) } / points.size,
                points.sumOf { (x, y) -> Color.green(bitmap.getPixel(x, y)) } / points.size,
                points.sumOf { (x, y) -> Color.blue(bitmap.getPixel(x, y)) } / points.size,
            )
        }

        private fun blend(left: Int, right: Int, amount: Double): Int {
            fun channel(a: Int, b: Int) = (a + (b - a) * amount).roundToInt().coerceIn(0, 255)
            return Color.rgb(
                channel(Color.red(left), Color.red(right)),
                channel(Color.green(left), Color.green(right)),
                channel(Color.blue(left), Color.blue(right)),
            )
        }

        private fun colorDistance(left: Int, right: Int): Double {
            val dr = Color.red(left) - Color.red(right)
            val dg = Color.green(left) - Color.green(right)
            val db = Color.blue(left) - Color.blue(right)
            return sqrt((dr * dr + dg * dg + db * db).toDouble())
        }
    }
}

internal object NativeSkinnedMeshRenderer3D {
    private data class SkinnedVertex(
        val world: NativeStagePoint,
        val normal: NativeStagePoint,
        val bindPosition: NativeStagePoint,
        val bindNormal: NativeStagePoint,
        val material: NativeMaterialSlot3D,
    )

    private data class ProjectedVertex(
        val x: Double,
        val y: Double,
        val depth: Double,
        val world: NativeStagePoint,
        val normal: NativeStagePoint,
        val bindPosition: NativeStagePoint,
        val bindNormal: NativeStagePoint,
        val material: NativeMaterialSlot3D,
    )

    private data class ProjectedTriangle(
        val a: ProjectedVertex,
        val b: ProjectedVertex,
        val c: ProjectedVertex,
        val averageDepth: Double,
        val material: NativeMaterialSlot3D,
        val shade: Double,
        val textureColor: Int,
    )

    fun render(
        target: Bitmap,
        model: NativeCharacterModel3D,
        performance: NativeActingPerformance,
        camera: NativeProductionCameraSample,
        palette: NativeReferencePalette3D,
        timeSeconds: Double,
    ): NativeMeshFrameGeometry3D {
        require(target.width > 0 && target.height > 0) { "3D render target must have positive dimensions." }
        val root = sampleRoot(performance, timeSeconds)
        val boneRotations = model.bindJoints.keys.associateWith { role -> sampleBoneRotation(performance, role, timeSeconds) }
        val bounds = NativeModelBounds3D.from(model)
        val skinned = model.vertices.map { vertex ->
            skinVertex(vertex, model, boneRotations, root)
        }

        val projected = skinned.map { vertex -> project(vertex, camera, target.width, target.height) }
        val light = requireNotNull(normalize(NativeStagePoint(0.35, 0.70, 1.0)))
        val triangles = model.triangles.mapNotNull { triangle ->
            val a = projected.getOrNull(triangle.a) ?: return@mapNotNull null
            val b = projected.getOrNull(triangle.b) ?: return@mapNotNull null
            val c = projected.getOrNull(triangle.c) ?: return@mapNotNull null
            val faceNormal = normalize(cross(sub(b.world, a.world), sub(c.world, a.world))) ?: return@mapNotNull null
            val shade = (0.36 + 0.64 * abs(dot(faceNormal, light))).coerceIn(0.24, 1.0)
            val bindPosition = NativeStagePoint(
                (a.bindPosition.x + b.bindPosition.x + c.bindPosition.x) / 3.0,
                (a.bindPosition.y + b.bindPosition.y + c.bindPosition.y) / 3.0,
                (a.bindPosition.z + b.bindPosition.z + c.bindPosition.z) / 3.0,
            )
            val bindNormal = normalize(
                NativeStagePoint(
                    a.bindNormal.x + b.bindNormal.x + c.bindNormal.x,
                    a.bindNormal.y + b.bindNormal.y + c.bindNormal.y,
                    a.bindNormal.z + b.bindNormal.z + c.bindNormal.z,
                ),
            ) ?: a.bindNormal
            ProjectedTriangle(
                a = a,
                b = b,
                c = c,
                averageDepth = (a.depth + b.depth + c.depth) / 3.0,
                material = a.material,
                shade = shade,
                textureColor = palette.texturedColor(a.material, bindPosition, bindNormal, bounds),
            )
        }.sortedByDescending { it.averageDepth }

        val canvas = Canvas(target)
        canvas.drawColor(Color.rgb(10, 12, 16))
        val groundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(18, 21, 27) }
        canvas.drawRect(0f, target.height * 0.79f, target.width.toFloat(), target.height.toFloat(), groundPaint)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        val path = Path()
        var minX = Double.POSITIVE_INFINITY
        var minY = Double.POSITIVE_INFINITY
        var maxX = Double.NEGATIVE_INFINITY
        var maxY = Double.NEGATIVE_INFINITY
        var nearest = Double.POSITIVE_INFINITY
        var farthest = 0.0

        triangles.forEach { triangle ->
            path.reset()
            path.moveTo(triangle.a.x.toFloat(), triangle.a.y.toFloat())
            path.lineTo(triangle.b.x.toFloat(), triangle.b.y.toFloat())
            path.lineTo(triangle.c.x.toFloat(), triangle.c.y.toFloat())
            path.close()
            paint.color = shadeColor(triangle.textureColor, triangle.shade)
            canvas.drawPath(path, paint)

            minX = min(minX, min(triangle.a.x, min(triangle.b.x, triangle.c.x)))
            minY = min(minY, min(triangle.a.y, min(triangle.b.y, triangle.c.y)))
            maxX = max(maxX, max(triangle.a.x, max(triangle.b.x, triangle.c.x)))
            maxY = max(maxY, max(triangle.a.y, max(triangle.b.y, triangle.c.y)))
            nearest = min(nearest, min(triangle.a.depth, min(triangle.b.depth, triangle.c.depth)))
            farthest = max(farthest, max(triangle.a.depth, max(triangle.b.depth, triangle.c.depth)))
        }

        if (triangles.isEmpty()) {
            return NativeMeshFrameGeometry3D(0.0, 0.0, 0L, 0, 0.0, 0.0)
        }
        val clippedMinX = minX.coerceIn(0.0, target.width.toDouble())
        val clippedMaxX = maxX.coerceIn(0.0, target.width.toDouble())
        val clippedMinY = minY.coerceIn(0.0, target.height.toDouble())
        val clippedMaxY = maxY.coerceIn(0.0, target.height.toDouble())
        val drawWidth = max(0.0, clippedMaxX - clippedMinX)
        val drawHeight = max(0.0, clippedMaxY - clippedMinY)
        val coverage = max(1L, (drawWidth * drawHeight * 0.62).roundToInt().toLong())
        return NativeMeshFrameGeometry3D(
            drawWidth = drawWidth,
            drawHeight = drawHeight,
            coveragePixels = coverage,
            visibleTriangles = triangles.size,
            nearestDepth = nearest,
            farthestDepth = farthest,
        )
    }

    private fun skinVertex(
        vertex: NativeMeshVertex3D,
        model: NativeCharacterModel3D,
        rotations: Map<NativeSemanticBoneRole, NativeEulerDegrees>,
        root: NativeStagePoint,
    ): SkinnedVertex {
        var px = 0.0
        var py = 0.0
        var pz = 0.0
        var nx = 0.0
        var ny = 0.0
        var nz = 0.0
        vertex.influences.forEach { influence ->
            val pivot = model.bindJoints[influence.bone]?.bindPosition ?: NativeStagePoint(0.0, 0.0, 0.0)
            val rotation = rotations[influence.bone] ?: NativeEulerDegrees()
            val local = sub(vertex.bindPosition, pivot)
            val rotated = rotateEuler(local, rotation)
            val position = add(add(pivot, rotated), root)
            val normal = rotateEuler(vertex.bindNormal, rotation)
            px += position.x * influence.weight
            py += position.y * influence.weight
            pz += position.z * influence.weight
            nx += normal.x * influence.weight
            ny += normal.y * influence.weight
            nz += normal.z * influence.weight
        }
        val normal = normalize(NativeStagePoint(nx, ny, nz)) ?: NativeStagePoint(0.0, 0.0, 1.0)
        return SkinnedVertex(
            world = NativeStagePoint(px, py, pz),
            normal = normal,
            bindPosition = vertex.bindPosition,
            bindNormal = vertex.bindNormal,
            material = vertex.material,
        )
    }

    private fun project(
        vertex: SkinnedVertex,
        camera: NativeProductionCameraSample,
        width: Int,
        height: Int,
    ): ProjectedVertex? {
        val forward = normalize(sub(camera.target, camera.position)) ?: return null
        var right = normalize(cross(forward, NativeStagePoint(0.0, 1.0, 0.0)))
        if (right == null) right = normalize(cross(forward, NativeStagePoint(0.0, 0.0, 1.0)))
        right ?: return null
        val up = normalize(cross(right, forward)) ?: return null
        val relative = sub(vertex.world, camera.position)
        val depth = dot(relative, forward)
        if (!depth.isFinite() || depth <= 0.05) return null
        val tangent = kotlin.math.tan(Math.toRadians(camera.verticalFovDegrees) / 2.0)
        val aspect = width.toDouble() / height.toDouble()
        if (!tangent.isFinite() || tangent <= 0.0 || !aspect.isFinite() || aspect <= 0.0) return null
        val ndcX = dot(relative, right) / (depth * tangent * aspect)
        val ndcY = dot(relative, up) / (depth * tangent)
        if (!ndcX.isFinite() || !ndcY.isFinite()) return null
        return ProjectedVertex(
            x = (ndcX * 0.5 + 0.5) * width,
            y = (0.5 - ndcY * 0.5) * height,
            depth = depth,
            world = vertex.world,
            normal = vertex.normal,
            bindPosition = vertex.bindPosition,
            bindNormal = vertex.bindNormal,
            material = vertex.material,
        )
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
            val sampled = sampleTrack(track, timeSeconds)
            sampled.rotations[role]?.let { return it }
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
            val rotations = roles.associateWith { role ->
                val from = left.rotations[role] ?: NativeEulerDegrees()
                val to = right.rotations[role] ?: NativeEulerDegrees()
                NativeEulerDegrees(
                    lerp(from.x, to.x, amount),
                    lerp(from.y, to.y, amount),
                    lerp(from.z, to.z, amount),
                )
            }
            return NativePerformancePoseKeyframe(
                timeSeconds = timeSeconds,
                rootPosition = lerp(left.rootPosition, right.rootPosition, amount),
                rotations = rotations,
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
        return NativeStagePoint(x2 * cz - y2 * sz, x2 * sz + y2 * cz, z2)
    }

    private fun shadeColor(color: Int, shade: Double): Int = Color.rgb(
        (Color.red(color) * shade).roundToInt().coerceIn(0, 255),
        (Color.green(color) * shade).roundToInt().coerceIn(0, 255),
        (Color.blue(color) * shade).roundToInt().coerceIn(0, 255),
    )

    private fun lerp(left: Double, right: Double, amount: Double): Double = left + (right - left) * amount

    private fun lerp(left: NativeStagePoint, right: NativeStagePoint, amount: Double) = NativeStagePoint(
        lerp(left.x, right.x, amount), lerp(left.y, right.y, amount), lerp(left.z, right.z, amount),
    )

    private fun add(left: NativeStagePoint, right: NativeStagePoint) = NativeStagePoint(
        left.x + right.x, left.y + right.y, left.z + right.z,
    )

    private fun sub(left: NativeStagePoint, right: NativeStagePoint) = NativeStagePoint(
        left.x - right.x, left.y - right.y, left.z - right.z,
    )

    private fun dot(left: NativeStagePoint, right: NativeStagePoint): Double =
        left.x * right.x + left.y * right.y + left.z * right.z

    private fun cross(left: NativeStagePoint, right: NativeStagePoint) = NativeStagePoint(
        left.y * right.z - left.z * right.y,
        left.z * right.x - left.x * right.z,
        left.x * right.y - left.y * right.x,
    )

    private fun normalize(value: NativeStagePoint): NativeStagePoint? {
        val length = sqrt(dot(value, value))
        if (!length.isFinite() || length <= 1e-12) return null
        return NativeStagePoint(value.x / length, value.y / length, value.z / length)
    }
}
