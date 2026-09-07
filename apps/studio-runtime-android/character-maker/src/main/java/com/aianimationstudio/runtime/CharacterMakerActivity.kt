package com.aianimationstudio.runtime

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class CharacterMakerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    CharacterMakerShell()
                }
            }
        }
    }
}

@Composable
private fun CharacterMakerShell() {
    val context = LocalContext.current
    var selectedUri by rememberSaveable { mutableStateOf<String?>(null) }
    var preview by remember { mutableStateOf<ImageBitmap?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            selectedUri = uri.toString()
            preview = null
            error = null
        }
    }

    LaunchedEffect(selectedUri) {
        val uri = selectedUri?.let(Uri::parse) ?: return@LaunchedEffect
        loading = true
        preview = null
        error = null
        try {
            preview = withContext(Dispatchers.IO) { decodeBoundedPreview(context, uri) }.asImageBitmap()
        } catch (failure: Exception) {
            error = failure.message ?: "Նկարը չհաջողվեց բացել։"
        } finally {
            loading = false
        }
    }

    Scaffold { innerPadding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(innerPadding).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("3D կերպար", style = MaterialTheme.typography.headlineMedium)
            Text("Ընտրեք կերպարի նկար։ Առանձին հավելվածի առաջին փուլում կարող եք ստուգել ներմուծումն ու նախադիտումը։")
            Button(onClick = { picker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
                Text("Ընտրել նկար")
            }
            if (loading) Text("Բացվում է նկարը…")
            preview?.let { image ->
                Image(
                    bitmap = image,
                    contentDescription = "Ընտրված կերպարի նկարը",
                    modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp),
                    contentScale = ContentScale.Fit,
                )
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {},
                enabled = CharacterMakerShellContract.canCreate3D(selectedUri != null && preview != null),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Ստեղծել 3D")
            }
            Text("3D կառուցման գործողությունը դեռ միացված չէ։ Այս էկրանը չի ներկայացնում նկարը որպես պատրաստի 3D մոդել։", style = MaterialTheme.typography.bodySmall)
            Text("Հիմք՝ ${BuildConfig.STUDIO_COMMIT_SHA.take(12)}", style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** Decode only a bounded preview; the exact source bytes will be owned by the Phase-2 importer. */
private fun decodeBoundedPreview(context: Context, uri: Uri): android.graphics.Bitmap {
    val resolver = context.contentResolver
    require(CharacterMakerShellContract.acceptsImageMime(resolver.getType(uri))) { "Ընտրված ֆայլը նկար չէ։" }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        ?: throw IllegalArgumentException("Նկարը չհաջողվեց բացել։")
    require(bounds.outWidth in 1..32768 && bounds.outHeight in 1..32768) { "Նկարի չափերը թույլատրելի չեն։" }
    var sample = 1
    while (bounds.outWidth / sample > 1024 || bounds.outHeight / sample > 1024) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    return resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        ?: throw IllegalArgumentException("Նկարը չհաջողվեց կարդալ։")
}
