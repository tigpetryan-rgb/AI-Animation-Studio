package com.aianimationstudio.runtime

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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CharacterMakerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    CharacterMakerApp()
                }
            }
        }
    }
}

@Composable
private fun CharacterMakerApp() {
    val context = LocalContext.current
    val controller = remember(context) { CharacterMakerController(context) }
    val scope = rememberCoroutineScope()
    var reference by remember { mutableStateOf<PersistedReferenceAsset?>(null) }
    var preview by remember { mutableStateOf<ImageBitmap?>(null) }
    var importError by remember { mutableStateOf<String?>(null) }
    var buildResult by remember { mutableStateOf<CharacterMakerBuildResult?>(null) }
    var importing by remember { mutableStateOf(false) }
    var building by remember { mutableStateOf(false) }
    var pendingUri by remember { mutableStateOf<Uri?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            pendingUri = uri
            importError = null
            buildResult = null
        }
    }

    LaunchedEffect(Unit) {
        reference = withContext(Dispatchers.IO) { controller.restoreReference() }
        preview = reference?.let { decodeReferencePreview(it) }
        val restored = reference?.let { exact ->
            withContext(Dispatchers.IO) { controller.restoreDefinition(exact) }
        }
        if (restored != null) {
            buildResult = CharacterMakerBuildResult.Ready(
                definitionId = restored.definition.definitionId,
                vertexCount = restored.definition.asset.vertexCount,
                triangleCount = restored.definition.asset.triangleCount,
                referenceSha256 = restored.definition.appearance.referenceSha256,
                assetPayloadSha256 = restored.assetPayloadSha256,
                manifestSha256 = restored.manifestSha256,
            )
        }
    }

    LaunchedEffect(pendingUri) {
        val uri = pendingUri ?: return@LaunchedEffect
        importing = true
        importError = null
        buildResult = null
        try {
            val imported = withContext(Dispatchers.IO) { controller.importReference(uri) }
            reference = imported
            preview = decodeReferencePreview(imported)
        } catch (failure: Exception) {
            reference = null
            preview = null
            importError = failure.message ?: "Նկարը չհաջողվեց ներմուծել։"
        } finally {
            importing = false
            pendingUri = null
        }
    }

    Scaffold { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("3D կերպար", style = MaterialTheme.typography.headlineMedium)
            Text("Ընտրեք կերպարի նկար, այնուհետև ստեղծեք M58-ի իրական mesh + rig + skinning հիմքով պահպանվող 3D կերպար։")

            Button(
                onClick = { picker.launch("image/*") },
                enabled = !importing && !building,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (importing) "Ներմուծվում է…" else "Ընտրել նկար")
            }

            preview?.let { image ->
                Image(
                    bitmap = image,
                    contentDescription = "Ընտրված կերպարի reference նկարը",
                    modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp),
                    contentScale = ContentScale.Fit,
                )
            }

            reference?.let { exact ->
                Text("Reference SHA-256: ${exact.sha256.take(16)}…", style = MaterialTheme.typography.labelSmall)
            }
            importError?.let { Text(it, color = MaterialTheme.colorScheme.error) }

            Button(
                onClick = {
                    val exact = reference ?: return@Button
                    building = true
                    buildResult = null
                    scope.launch {
                        buildResult = withContext(Dispatchers.Default) { controller.build(exact) }
                        building = false
                    }
                },
                enabled = !building && CharacterMakerShellContract.canCreate3D(reference != null),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (building) "Կառուցվում է 3D…" else "Ստեղծել 3D")
            }

            when (val result = buildResult) {
                is CharacterMakerBuildResult.Ready -> {
                    Text("3D կերպարը ստեղծված և պահպանված է։", style = MaterialTheme.typography.titleMedium)
                    Text("Vertices: ${result.vertexCount} · Triangles: ${result.triangleCount}")
                    Text("Definition: ${result.definitionId.take(28)}…", style = MaterialTheme.typography.bodySmall)
                    Text("Asset SHA-256: ${result.assetPayloadSha256.take(16)}…", style = MaterialTheme.typography.bodySmall)
                }
                is CharacterMakerBuildResult.Rejected -> {
                    Text("3D կառուցումը մերժվեց։", color = MaterialTheme.colorScheme.error)
                    result.diagnostics.forEach { diagnostic ->
                        Text("${diagnostic.code}: ${diagnostic.message}", style = MaterialTheme.typography.bodySmall)
                    }
                }
                null -> Unit
            }

            Text(
                "Այս փուլը կառուցում է իրական ծավալային, rigged/skinned M58 mesh և պահպանում է reusable character definition-ը։ Այն photogrammetry չէ և դեռ չունի պտտվող 3D viewer։",
                style = MaterialTheme.typography.bodySmall,
            )
            Text("Source: ${BuildConfig.STUDIO_COMMIT_SHA.take(12)}", style = MaterialTheme.typography.labelSmall)
        }
    }
}

private suspend fun decodeReferencePreview(reference: PersistedReferenceAsset): ImageBitmap? =
    withContext(Dispatchers.IO) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(reference.localFile.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@withContext null
        var sample = 1
        while (bounds.outWidth / sample > 1024 || bounds.outHeight / sample > 1024) sample *= 2
        BitmapFactory.decodeFile(
            reference.localFile.absolutePath,
            BitmapFactory.Options().apply { inSampleSize = sample },
        )?.asImageBitmap()
    }
