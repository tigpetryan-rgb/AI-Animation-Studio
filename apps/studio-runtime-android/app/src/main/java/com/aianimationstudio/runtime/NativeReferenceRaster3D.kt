package com.aianimationstudio.runtime

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.util.zip.CRC32
import java.util.zip.InflaterInputStream

/**
 * Small deterministic PNG raster decoder used by Phase-3 reconstruction before Android Bitmap
 * fallback. It keeps the reference-shape path executable in JVM CI and on-device while avoiding a
 * network/model dependency. Supported PNGs are 8-bit, non-interlaced grayscale/RGB/indexed/GA/RGBA.
 */
internal data class NativeReferenceRaster3D(
    val width: Int,
    val height: Int,
    private val argb: IntArray,
) {
    init {
        require(width > 0 && height > 0)
        require(argb.size == width * height)
    }

    fun pixelAt(x: Int, y: Int): Int = argb[y * width + x]
}

internal object NativeReferenceRaster3DDecoder {
    private val PNG_SIGNATURE = byteArrayOf(
        0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    )
    private const val MAX_DIMENSION = 8_192
    private const val MAX_PIXELS = 16_777_216
    private const val MAX_COMPRESSED_BYTES = 32 * 1024 * 1024

    fun decode(file: File, mimeType: String): NativeReferenceRaster3D? {
        if (!file.isFile || file.length() !in 1..MAX_COMPRESSED_BYTES.toLong()) return null
        val bytes = try {
            FileInputStream(file).use { it.readBytes() }
        } catch (_: Exception) {
            return null
        }
        return decode(bytes, mimeType)
    }

    fun decode(bytes: ByteArray, mimeType: String): NativeReferenceRaster3D? {
        if (mimeType.lowercase() != "image/png") return null
        if (bytes.size < PNG_SIGNATURE.size || !bytes.copyOfRange(0, PNG_SIGNATURE.size).contentEquals(PNG_SIGNATURE)) return null

        var width = 0
        var height = 0
        var bitDepth = -1
        var colorType = -1
        var compression = -1
        var filterMethod = -1
        var interlace = -1
        var palette: ByteArray? = null
        var paletteAlpha: ByteArray? = null
        val idat = ByteArrayOutputStream()
        var offset = PNG_SIGNATURE.size
        var sawHeader = false
        var sawEnd = false

        while (offset + 12 <= bytes.size) {
            val length = readInt(bytes, offset)
            if (length < 0 || length > MAX_COMPRESSED_BYTES) return null
            val typeOffset = offset + 4
            val dataOffset = typeOffset + 4
            val crcOffset = dataOffset + length
            if (crcOffset + 4 > bytes.size) return null
            val typeBytes = bytes.copyOfRange(typeOffset, typeOffset + 4)
            val type = typeBytes.toString(Charsets.US_ASCII)
            if (!validCrc(typeBytes, bytes, dataOffset, length, readInt(bytes, crcOffset))) return null

            when (type) {
                "IHDR" -> {
                    if (sawHeader || length != 13) return null
                    width = readInt(bytes, dataOffset)
                    height = readInt(bytes, dataOffset + 4)
                    bitDepth = bytes[dataOffset + 8].toInt() and 0xff
                    colorType = bytes[dataOffset + 9].toInt() and 0xff
                    compression = bytes[dataOffset + 10].toInt() and 0xff
                    filterMethod = bytes[dataOffset + 11].toInt() and 0xff
                    interlace = bytes[dataOffset + 12].toInt() and 0xff
                    if (width !in 1..MAX_DIMENSION || height !in 1..MAX_DIMENSION) return null
                    if (width.toLong() * height.toLong() > MAX_PIXELS.toLong()) return null
                    sawHeader = true
                }
                "PLTE" -> palette = bytes.copyOfRange(dataOffset, dataOffset + length)
                "tRNS" -> paletteAlpha = bytes.copyOfRange(dataOffset, dataOffset + length)
                "IDAT" -> {
                    if (!sawHeader || idat.size() + length > MAX_COMPRESSED_BYTES) return null
                    idat.write(bytes, dataOffset, length)
                }
                "IEND" -> {
                    if (length != 0) return null
                    sawEnd = true
                    offset = crcOffset + 4
                    break
                }
            }
            offset = crcOffset + 4
        }

        if (!sawHeader || !sawEnd || idat.size() <= 0) return null
        if (bitDepth != 8 || compression != 0 || filterMethod != 0 || interlace != 0) return null
        val bytesPerPixel = when (colorType) {
            0 -> 1
            2 -> 3
            3 -> 1
            4 -> 2
            6 -> 4
            else -> return null
        }
        if (colorType == 3 && (palette == null || palette!!.isEmpty() || palette!!.size % 3 != 0)) return null

        val rowBytes = width * bytesPerPixel
        val expectedInflated = height.toLong() * (rowBytes + 1L)
        if (expectedInflated <= 0L || expectedInflated > (MAX_PIXELS.toLong() * 5L + MAX_DIMENSION)) return null
        val inflated = inflateBounded(idat.toByteArray(), expectedInflated.toInt()) ?: return null
        if (inflated.size != expectedInflated.toInt()) return null

        val reconstructed = ByteArray(height * rowBytes)
        var inputOffset = 0
        for (y in 0 until height) {
            val filter = inflated[inputOffset++].toInt() and 0xff
            val rowStart = y * rowBytes
            val previousStart = (y - 1) * rowBytes
            for (xByte in 0 until rowBytes) {
                val raw = inflated[inputOffset++].toInt() and 0xff
                val left = if (xByte >= bytesPerPixel) reconstructed[rowStart + xByte - bytesPerPixel].toInt() and 0xff else 0
                val up = if (y > 0) reconstructed[previousStart + xByte].toInt() and 0xff else 0
                val upLeft = if (y > 0 && xByte >= bytesPerPixel) reconstructed[previousStart + xByte - bytesPerPixel].toInt() and 0xff else 0
                val predictor = when (filter) {
                    0 -> 0
                    1 -> left
                    2 -> up
                    3 -> (left + up) / 2
                    4 -> paeth(left, up, upLeft)
                    else -> return null
                }
                reconstructed[rowStart + xByte] = ((raw + predictor) and 0xff).toByte()
            }
        }

        val pixels = IntArray(width * height)
        var pixelIndex = 0
        var byteIndex = 0
        while (pixelIndex < pixels.size) {
            val color = when (colorType) {
                0 -> {
                    val gray = reconstructed[byteIndex++].toInt() and 0xff
                    argb(255, gray, gray, gray)
                }
                2 -> {
                    val r = reconstructed[byteIndex++].toInt() and 0xff
                    val g = reconstructed[byteIndex++].toInt() and 0xff
                    val b = reconstructed[byteIndex++].toInt() and 0xff
                    argb(255, r, g, b)
                }
                3 -> {
                    val index = reconstructed[byteIndex++].toInt() and 0xff
                    val paletteBytes = requireNotNull(palette)
                    val paletteOffset = index * 3
                    if (paletteOffset + 2 >= paletteBytes.size) return null
                    val alpha = paletteAlpha?.getOrNull(index)?.toInt()?.and(0xff) ?: 255
                    argb(
                        alpha,
                        paletteBytes[paletteOffset].toInt() and 0xff,
                        paletteBytes[paletteOffset + 1].toInt() and 0xff,
                        paletteBytes[paletteOffset + 2].toInt() and 0xff,
                    )
                }
                4 -> {
                    val gray = reconstructed[byteIndex++].toInt() and 0xff
                    val alpha = reconstructed[byteIndex++].toInt() and 0xff
                    argb(alpha, gray, gray, gray)
                }
                6 -> {
                    val r = reconstructed[byteIndex++].toInt() and 0xff
                    val g = reconstructed[byteIndex++].toInt() and 0xff
                    val b = reconstructed[byteIndex++].toInt() and 0xff
                    val alpha = reconstructed[byteIndex++].toInt() and 0xff
                    argb(alpha, r, g, b)
                }
                else -> return null
            }
            pixels[pixelIndex++] = color
        }
        return NativeReferenceRaster3D(width, height, pixels)
    }

    private fun inflateBounded(compressed: ByteArray, expected: Int): ByteArray? = try {
        InflaterInputStream(ByteArrayInputStream(compressed)).use { input ->
            val output = ByteArrayOutputStream(expected)
            val buffer = ByteArray(8 * 1024)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (read == 0) continue
                total += read
                if (total > expected) return null
                output.write(buffer, 0, read)
            }
            output.toByteArray()
        }
    } catch (_: Exception) {
        null
    }

    private fun validCrc(type: ByteArray, bytes: ByteArray, dataOffset: Int, length: Int, expectedSigned: Int): Boolean {
        val crc = CRC32()
        crc.update(type)
        crc.update(bytes, dataOffset, length)
        val expected = expectedSigned.toLong() and 0xffffffffL
        return crc.value == expected
    }

    private fun readInt(bytes: ByteArray, offset: Int): Int =
        ((bytes[offset].toInt() and 0xff) shl 24) or
            ((bytes[offset + 1].toInt() and 0xff) shl 16) or
            ((bytes[offset + 2].toInt() and 0xff) shl 8) or
            (bytes[offset + 3].toInt() and 0xff)

    private fun paeth(a: Int, b: Int, c: Int): Int {
        val p = a + b - c
        val pa = kotlin.math.abs(p - a)
        val pb = kotlin.math.abs(p - b)
        val pc = kotlin.math.abs(p - c)
        return when {
            pa <= pb && pa <= pc -> a
            pb <= pc -> b
            else -> c
        }
    }

    private fun argb(a: Int, r: Int, g: Int, b: Int): Int =
        ((a and 0xff) shl 24) or ((r and 0xff) shl 16) or ((g and 0xff) shl 8) or (b and 0xff)
}
