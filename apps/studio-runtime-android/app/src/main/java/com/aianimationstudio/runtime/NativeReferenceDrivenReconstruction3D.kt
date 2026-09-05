package com.aianimationstudio.runtime

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

internal data class NativeReferenceViewEvidence3D(
    val leftFraction: Double,
    val topFraction: Double,
    val rightFraction: Double,
    val bottomFraction: Double,
    val foregroundSamples: Int,
) {
    val widthFraction: Double get() = rightFraction - leftFraction
    val heightFraction: Double get() = bottomFraction - topFraction
    val aspect: Double get() = if (heightFraction <= 0.0) 0.0 else widthFraction / heightFraction
}

internal data class NativeReferenceShapeProfile3D(
    val mode: String,
    val widthScale: Double,
    val depthScale: Double,
    val viewEvidence: List<NativeReferenceViewEvidence3D>,
)

/**
 * Extracts coarse multi-view shape evidence from a character/reference sheet without network or
 * model dependencies. It deliberately does not claim learned photogrammetry. PNG references use a
 * deterministic pure raster path first so the same visual reconstruction logic is executable in
 * JVM CI and on-device; other admitted image formats retain Android Bitmap fallback.
 */
internal object NativeReferenceShapeAnalyzer3D {
    private const val SAMPLE_LIMIT = 160
    private const val COLOR_BUCKET_SHIFT = 5
    private const val BACKGROUND_DISTANCE = 46.0

    fun analyze(reference: PersistedReferenceAsset): NativeReferenceShapeProfile3D? {
        if (!reference.localFile.isFile || reference.localFile.length() <= 0L) return null
        val raster = runCatching {
            NativeReferenceRaster3DDecoder.decode(reference.localFile, reference.mimeType)
        }.getOrNull()
        if (raster != null) return analyzeRaster(raster)

        val bitmap = BitmapFactory.decodeFile(reference.localFile.absolutePath) ?: return null
        return try {
            analyzeBitmap(bitmap)
        } finally {
            bitmap.recycle()
        }
    }

    internal fun analyzeRaster(raster: NativeReferenceRaster3D): NativeReferenceShapeProfile3D? =
        analyzePixels(raster.width, raster.height) { x, y -> raster.pixelAt(x, y) }

    internal fun analyzeBitmap(bitmap: Bitmap): NativeReferenceShapeProfile3D? =
        analyzePixels(bitmap.width, bitmap.height) { x, y -> bitmap.getPixel(x, y) }

    private fun analyzePixels(
        sourceWidth: Int,
        sourceHeight: Int,
        pixelAt: (Int, Int) -> Int,
    ): NativeReferenceShapeProfile3D? {
        if (sourceWidth <= 0 || sourceHeight <= 0) return null
        val sampleWidth: Int
        val sampleHeight: Int
        if (sourceWidth >= sourceHeight) {
            sampleWidth = min(SAMPLE_LIMIT, sourceWidth)
            sampleHeight = max(1, (sampleWidth.toDouble() * sourceHeight / sourceWidth).toInt())
        } else {
            sampleHeight = min(SAMPLE_LIMIT, sourceHeight)
            sampleWidth = max(1, (sampleHeight.toDouble() * sourceWidth / sourceHeight).toInt())
        }

        val pixels = IntArray(sampleWidth * sampleHeight)
        for (y in 0 until sampleHeight) {
            val sourceY = ((y + 0.5) * sourceHeight / sampleHeight).toInt().coerceIn(0, sourceHeight - 1)
            for (x in 0 until sampleWidth) {
                val sourceX = ((x + 0.5) * sourceWidth / sampleWidth).toInt().coerceIn(0, sourceWidth - 1)
                pixels[y * sampleWidth + x] = pixelAt(sourceX, sourceY)
            }
        }

        val background = dominantColor(pixels)
        val foreground = BooleanArray(pixels.size) { index ->
            colorDistance(pixels[index], background) >= BACKGROUND_DISTANCE && alpha(pixels[index]) >= 64
        }
        val components = components(foreground, sampleWidth, sampleHeight)
            .filter { component ->
                component.samples >= max(12, (sampleWidth * sampleHeight * 0.0025).toInt()) &&
                    component.width >= max(3, (sampleWidth * 0.035).toInt()) &&
                    component.height >= max(5, (sampleHeight * 0.09).toInt())
            }

        if (components.isEmpty()) return null
        val normalized = components.map { component ->
            NativeReferenceViewEvidence3D(
                leftFraction = component.left.toDouble() / sampleWidth,
                topFraction = component.top.toDouble() / sampleHeight,
                rightFraction = (component.right + 1).toDouble() / sampleWidth,
                bottomFraction = (component.bottom + 1).toDouble() / sampleHeight,
                foregroundSamples = component.samples,
            )
        }

        // Fractions are normalized independently on X/Y, so widthFraction / heightFraction is
        // distorted whenever the sampled sheet is not square. Restore pixel-space aspect before
        // classifying silhouettes or deriving geometry scales.
        val sampleAspect = sampleWidth.toDouble() / sampleHeight.toDouble()
        fun pixelAspect(evidence: NativeReferenceViewEvidence3D): Double = evidence.aspect * sampleAspect

        // Character sheets commonly place front/side/back isolated views in the upper-right region.
        // Prefer those when present; otherwise use the largest isolated full-body candidate.
        val upperRight = normalized.filter { evidence ->
            evidence.leftFraction >= 0.38 &&
                evidence.topFraction <= 0.36 &&
                evidence.heightFraction >= 0.14 &&
                evidence.heightFraction <= 0.62 &&
                evidence.widthFraction <= 0.36
        }.sortedBy { it.leftFraction }

        val selected = if (upperRight.size >= 2) {
            upperRight.take(4)
        } else {
            normalized.sortedByDescending { it.foregroundSamples }.take(3)
        }.filter { pixelAspect(it) in 0.18..1.8 }

        if (selected.isEmpty()) return null
        val front = selected.maxByOrNull { it.widthFraction * it.heightFraction } ?: return null
        val side = selected
            .filter { it !== front }
            .minByOrNull { pixelAspect(it) }

        // The canonical stylized creature mesh has an overall full-body aspect near 0.72. Keep
        // deformation bounded so noisy sheets cannot create inverted or paper-thin geometry.
        val frontAspect = pixelAspect(front)
        val widthScale = (frontAspect / 0.72).coerceIn(0.78, 1.24)
        val depthFromViews = side?.let { candidate ->
            val ratio = pixelAspect(candidate) / frontAspect
            (ratio * 1.08).coerceIn(0.58, 1.08)
        } ?: 0.82
        val mode = if (upperRight.size >= 2) {
            "TURNAROUND_MULTI_VIEW_HEURISTIC_V1"
        } else {
            "SINGLE_VIEW_SHAPE_HEURISTIC_V1"
        }
        return NativeReferenceShapeProfile3D(
            mode = mode,
            widthScale = widthScale,
            depthScale = depthFromViews,
            viewEvidence = selected,
        )
    }

    private data class Component(
        var left: Int,
        var top: Int,
        var right: Int,
        var bottom: Int,
        var samples: Int,
    ) {
        val width: Int get() = right - left + 1
        val height: Int get() = bottom - top + 1
    }

    private fun components(mask: BooleanArray, width: Int, height: Int): List<Component> {
        val visited = BooleanArray(mask.size)
        val result = mutableListOf<Component>()
        val queue = IntArray(mask.size)
        for (start in mask.indices) {
            if (!mask[start] || visited[start]) continue
            var read = 0
            var write = 0
            queue[write++] = start
            visited[start] = true
            var left = start % width
            var right = left
            var top = start / width
            var bottom = top
            var count = 0
            while (read < write) {
                val index = queue[read++]
                val x = index % width
                val y = index / width
                left = min(left, x)
                right = max(right, x)
                top = min(top, y)
                bottom = max(bottom, y)
                count += 1

                fun admit(nx: Int, ny: Int) {
                    if (nx !in 0 until width || ny !in 0 until height) return
                    val next = ny * width + nx
                    if (!mask[next] || visited[next]) return
                    visited[next] = true
                    queue[write++] = next
                }
                admit(x - 1, y)
                admit(x + 1, y)
                admit(x, y - 1)
                admit(x, y + 1)
            }
            result += Component(left, top, right, bottom, count)
        }
        return result
    }

    private fun dominantColor(pixels: IntArray): Int {
        data class Bucket(var count: Int = 0, var r: Long = 0, var g: Long = 0, var b: Long = 0)
        val buckets = mutableMapOf<Int, Bucket>()
        pixels.forEach { pixel ->
            val r = red(pixel)
            val g = green(pixel)
            val b = blue(pixel)
            val key = ((r shr COLOR_BUCKET_SHIFT) shl 6) or
                ((g shr COLOR_BUCKET_SHIFT) shl 3) or
                (b shr COLOR_BUCKET_SHIFT)
            val bucket = buckets.getOrPut(key) { Bucket() }
            bucket.count += 1
            bucket.r += r
            bucket.g += g
            bucket.b += b
        }
        val best = buckets.maxByOrNull { it.value.count }?.value ?: return rgb(255, 255, 255)
        return rgb(
            (best.r / best.count).toInt().coerceIn(0, 255),
            (best.g / best.count).toInt().coerceIn(0, 255),
            (best.b / best.count).toInt().coerceIn(0, 255),
        )
    }

    private fun colorDistance(left: Int, right: Int): Double {
        val dr = red(left) - red(right)
        val dg = green(left) - green(right)
        val db = blue(left) - blue(right)
        return sqrt((dr * dr + dg * dg + db * db).toDouble())
    }

    private fun alpha(color: Int): Int = (color ushr 24) and 0xff
    private fun red(color: Int): Int = (color ushr 16) and 0xff
    private fun green(color: Int): Int = (color ushr 8) and 0xff
    private fun blue(color: Int): Int = color and 0xff
    private fun rgb(r: Int, g: Int, b: Int): Int =
        (0xff shl 24) or ((r and 0xff) shl 16) or ((g and 0xff) shl 8) or (b and 0xff)
}

internal object NativeReferenceDrivenCharacterModel3DBuilder {
    fun build(blocking: NativeSceneBlocking, rig: NativeCharacterRig): NativeCharacterModel3DResult {
        val base = when (val result = NativeCharacterModel3DBuilder.build(blocking, rig)) {
            is NativeCharacterModel3DResult.Ready -> result.model
            is NativeCharacterModel3DResult.Rejected -> return result
        }
        val profile = runCatching { NativeReferenceShapeAnalyzer3D.analyze(blocking.reference) }.getOrNull()
            ?: return NativeCharacterModel3DResult.Ready(base)

        val deformed = base.copy(
            vertices = base.vertices.map { vertex ->
                vertex.copy(
                    bindPosition = NativeStagePoint(
                        x = vertex.bindPosition.x * profile.widthScale,
                        y = vertex.bindPosition.y,
                        z = vertex.bindPosition.z * profile.depthScale,
                    ),
                    bindNormal = normalize(
                        NativeStagePoint(
                            x = vertex.bindNormal.x / profile.widthScale,
                            y = vertex.bindNormal.y,
                            z = vertex.bindNormal.z / profile.depthScale,
                        ),
                    ),
                )
            },
            bindJoints = base.bindJoints.mapValues { (_, joint) ->
                joint.copy(
                    bindPosition = NativeStagePoint(
                        x = joint.bindPosition.x * profile.widthScale,
                        y = joint.bindPosition.y,
                        z = joint.bindPosition.z * profile.depthScale,
                    ),
                )
            },
        )
        val diagnostics = NativeCharacterModel3DValidator.validate(deformed, rig)
        return if (diagnostics.isEmpty()) {
            NativeCharacterModel3DResult.Ready(deformed)
        } else {
            NativeCharacterModel3DResult.Rejected(diagnostics)
        }
    }

    private fun normalize(point: NativeStagePoint): NativeStagePoint {
        val length = sqrt(point.x * point.x + point.y * point.y + point.z * point.z)
        return if (!length.isFinite() || length <= 1e-12) {
            NativeStagePoint(0.0, 1.0, 0.0)
        } else {
            NativeStagePoint(point.x / length, point.y / length, point.z / length)
        }
    }
}
