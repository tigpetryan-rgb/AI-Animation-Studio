package com.aianimationstudio.runtime

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Locale

internal data class PersistedReferenceAsset(
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val width: Int,
    val height: Int,
    val sha256: String,
    val originUri: String,
    val localFile: File,
)

/**
 * Owns the exact source bytes used by the native production pipeline.
 *
 * The selected provider URI is treated only as an import source. The bytes are copied into
 * app-private storage before the asset becomes production-ready, so activity/runtime recreation
 * never depends on a stale browser File object or a provider continuing to expose the same bytes.
 */
internal class NativeSourceStore(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val sourceDirectory = File(appContext.filesDir, "production-source").apply { mkdirs() }
    private val sourceFile = File(sourceDirectory, SOURCE_FILE_NAME)

    fun importFrom(uri: Uri): PersistedReferenceAsset {
        val resolver = appContext.contentResolver
        var displayName = "reference-image"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) displayName = cursor.getString(index) ?: displayName
            }
        }

        val mimeType = resolver.getType(uri) ?: "application/octet-stream"
        require(mimeType.startsWith("image/")) { "The selected file is not an image." }

        val temp = File(sourceDirectory, "$SOURCE_FILE_NAME.tmp")
        if (temp.exists()) temp.delete()
        val digest = MessageDigest.getInstance("SHA-256")
        var bytesWritten = 0L

        try {
            resolver.openInputStream(uri)?.use { input ->
                FileOutputStream(temp).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        if (read == 0) continue
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        bytesWritten += read
                    }
                    output.fd.sync()
                }
            } ?: error("Unable to open the selected image.")

            require(bytesWritten > 0L) { "The selected image is empty." }
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(temp.absolutePath, options)
            require(options.outWidth > 0 && options.outHeight > 0) { "Unable to decode image dimensions." }

            replaceAtomically(temp, sourceFile)
            val sha256 = hex(digest.digest())
            val asset = PersistedReferenceAsset(
                displayName = displayName,
                mimeType = mimeType,
                sizeBytes = bytesWritten,
                width = options.outWidth,
                height = options.outHeight,
                sha256 = sha256,
                originUri = uri.toString(),
                localFile = sourceFile,
            )
            persistManifest(asset)
            return asset
        } catch (error: Exception) {
            temp.delete()
            throw error
        }
    }

    fun restoreVerified(): PersistedReferenceAsset? {
        if (!prefs.getBoolean(KEY_PRESENT, false) || !sourceFile.isFile) return null

        val expectedSize = prefs.getLong(KEY_SIZE, -1L)
        val expectedSha = prefs.getString(KEY_SHA256, null) ?: return clearAndNull()
        if (expectedSize <= 0L || sourceFile.length() != expectedSize) return clearAndNull()

        val actualSha = sha256(sourceFile)
        if (!actualSha.equals(expectedSha, ignoreCase = true)) return clearAndNull()

        val width = prefs.getInt(KEY_WIDTH, 0)
        val height = prefs.getInt(KEY_HEIGHT, 0)
        if (width <= 0 || height <= 0) return clearAndNull()

        return PersistedReferenceAsset(
            displayName = prefs.getString(KEY_DISPLAY_NAME, "reference-image") ?: "reference-image",
            mimeType = prefs.getString(KEY_MIME_TYPE, "application/octet-stream") ?: "application/octet-stream",
            sizeBytes = expectedSize,
            width = width,
            height = height,
            sha256 = actualSha,
            originUri = prefs.getString(KEY_ORIGIN_URI, "") ?: "",
            localFile = sourceFile,
        )
    }

    fun clear() {
        prefs.edit().clear().commit()
        sourceFile.delete()
        File(sourceDirectory, "$SOURCE_FILE_NAME.tmp").delete()
    }

    private fun persistManifest(asset: PersistedReferenceAsset) {
        val committed = prefs.edit()
            .putBoolean(KEY_PRESENT, true)
            .putString(KEY_DISPLAY_NAME, asset.displayName)
            .putString(KEY_MIME_TYPE, asset.mimeType)
            .putLong(KEY_SIZE, asset.sizeBytes)
            .putInt(KEY_WIDTH, asset.width)
            .putInt(KEY_HEIGHT, asset.height)
            .putString(KEY_SHA256, asset.sha256)
            .putString(KEY_ORIGIN_URI, asset.originUri)
            .commit()
        check(committed) { "Unable to persist source manifest." }
    }

    private fun clearAndNull(): PersistedReferenceAsset? {
        clear()
        return null
    }

    private fun replaceAtomically(temp: File, target: File) {
        if (target.exists() && !target.delete()) error("Unable to replace the previous source image.")
        if (temp.renameTo(target)) return

        FileInputStream(temp).use { input ->
            FileOutputStream(target).use { output ->
                input.copyTo(output)
                output.fd.sync()
            }
        }
        if (!temp.delete()) temp.deleteOnExit()
    }

    private fun sha256(file: File): String {
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
        return hex(digest.digest())
    }

    private fun hex(bytes: ByteArray): String = buildString(bytes.size * 2) {
        for (value in bytes) append(String.format(Locale.ROOT, "%02x", value.toInt() and 0xff))
    }

    private companion object {
        const val PREFS_NAME = "native-production-source-v1"
        const val SOURCE_FILE_NAME = "reference.bin"
        const val KEY_PRESENT = "present"
        const val KEY_DISPLAY_NAME = "displayName"
        const val KEY_MIME_TYPE = "mimeType"
        const val KEY_SIZE = "sizeBytes"
        const val KEY_WIDTH = "width"
        const val KEY_HEIGHT = "height"
        const val KEY_SHA256 = "sha256"
        const val KEY_ORIGIN_URI = "originUri"
    }
}
