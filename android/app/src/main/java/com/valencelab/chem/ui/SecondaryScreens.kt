package com.valencelab.chem.ui

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.valencelab.chem.chem.MoleculeGraph
import com.valencelab.chem.chem.MoleculeMetrics
import com.valencelab.chem.chem.PubChemCompound
import com.valencelab.chem.chem.TutorMessage
import com.valencelab.chem.chem.VisionAnalysisResult
import com.valencelab.chem.data.GeminiChemService
import com.valencelab.chem.data.PubChemService
import kotlinx.coroutines.launch

@Composable
fun TutorScreen(
    molecule: MoleculeGraph,
    metrics: MoleculeMetrics,
    onLoadSmilesInWorkbench: (smiles: String, label: String?) -> Boolean,
    modifier: Modifier = Modifier
) {
    val models = listOf(
        "gemini-3.8-flash" to "Balanced",
        "gemini-4-argon" to "Deep Reasoning",
        "gemini-3.1-flash-lite" to "Fast"
    )
    var selectedModel by remember { mutableStateOf("gemini-3.8-flash") }
    var draftMessage by remember { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    val messages = remember {
        mutableStateListOf(
            TutorMessage(
                id = "welcome",
                isUser = false,
                content = "Hello! I am your ValenceLab Chemistry Mentor. Ask me about VSEPR bond angles, orbital hybridization, resonance, or stereochemistry—or request any molecule to load in your 3D workbench."
            )
        )
    }
    val scope = rememberCoroutineScope()

    val quickPrompts = listOf(
        "Explain ${molecule.name.ifBlank { "this molecule" }} VSEPR geometry & hybridization",
        "Why is CO2 linear (180°) while H2O is bent (104.5°)?",
        "Compare cyclohexane chair vs boat conformational strain",
        "Propose an analgesic ester and output SMILES"
    )

    fun submitQuestion(questionText: String) {
        val trimmed = questionText.trim()
        if (trimmed.isEmpty() || isSending) return
        val userMsg = TutorMessage(
            id = "u_${System.currentTimeMillis()}",
            isUser = true,
            content = trimmed
        )
        messages.add(userMsg)
        draftMessage = ""
        errorMsg = null
        isSending = true

        scope.launch {
            try {
                val (reply, suggestedSmiles) = GeminiChemService.sendTutorMessage(
                    history = messages.toList(),
                    model = selectedModel,
                    molecule = molecule,
                    metrics = metrics
                )
                messages.add(
                    TutorMessage(
                        id = "m_${System.currentTimeMillis()}",
                        isUser = false,
                        content = reply,
                        modelUsed = selectedModel,
                        suggestedSmiles = suggestedSmiles
                    )
                )
            } catch (e: Exception) {
                errorMsg = e.message ?: "Failed to contact Chemistry Tutor."
            } finally {
                isSending = false
            }
        }
    }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Model Selector & Active Context Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Model:",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                models.forEach { (id, label) ->
                    FilterChip(
                        selected = selectedModel == id,
                        onClick = { selectedModel = id },
                        label = { Text(label, fontSize = 11.sp) },
                        modifier = Modifier.height(28.dp)
                    )
                }
                Spacer(Modifier.width(6.dp))
                Text(
                    text = "Context: ${molecule.name.ifBlank { "Custom" }} (${metrics.formula})",
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            // Quick Prompt Chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                quickPrompts.forEach { prompt ->
                    OutlinedButton(
                        onClick = { submitQuestion(prompt) },
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                        modifier = Modifier.height(28.dp)
                    ) {
                        Text(prompt, fontSize = 11.sp, maxLines = 1)
                    }
                }
            }

            // Chat History
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(messages, key = { it.id }) { msg ->
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = if (msg.isUser) Alignment.End else Alignment.Start
                    ) {
                        Surface(
                            color = if (msg.isUser) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth(0.92f)
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(
                                    text = msg.content,
                                    fontSize = 13.sp,
                                    color = if (msg.isUser) Color.White else MaterialTheme.colorScheme.onSurface
                                )
                                if (!msg.suggestedSmiles.isNullOrBlank()) {
                                    Spacer(Modifier.height(8.dp))
                                    Button(
                                        onClick = {
                                            val ok = onLoadSmilesInWorkbench(
                                                msg.suggestedSmiles,
                                                "Tutor Structure"
                                            )
                                            if (!ok) {
                                                errorMsg = "Could not parse suggested SMILES: ${msg.suggestedSmiles}"
                                            }
                                        },
                                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                                        modifier = Modifier.height(32.dp)
                                    ) {
                                        Icon(
                                            Icons.Default.Download,
                                            contentDescription = null,
                                            modifier = Modifier.size(14.dp)
                                        )
                                        Spacer(Modifier.width(6.dp))
                                        Text(
                                            "Load ${msg.suggestedSmiles} in 3D Workbench",
                                            fontSize = 11.sp
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (errorMsg != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = errorMsg.orEmpty(),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
            }

            // Input Row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = draftMessage,
                    onValueChange = { draftMessage = it },
                    placeholder = { Text("Ask a theoretical chemistry question...", fontSize = 12.sp) },
                    singleLine = true,
                    enabled = !isSending,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(6.dp))
                IconButton(
                    enabled = !isSending && draftMessage.isNotBlank(),
                    onClick = { submitQuestion(draftMessage) }
                ) {
                    if (isSending) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VisionScreen(
    onLoadSmilesInWorkbench: (smiles: String, label: String?) -> Boolean,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var selectedImageBytes by remember { mutableStateOf<ByteArray?>(null) }
    var selectedMimeType by remember { mutableStateOf("image/jpeg") }
    var questionText by remember { mutableStateOf("") }
    var isAnalyzing by remember { mutableStateOf(false) }
    var visionResult by remember { mutableStateOf<VisionAnalysisResult?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    val imagePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            try {
                val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes != null) {
                    selectedImageBytes = bytes
                    selectedMimeType = mime
                    visionResult = null
                    errorMsg = null
                }
            } catch (e: Exception) {
                errorMsg = e.message ?: "Unable to read selected image."
            }
        }
    }

    val previewBitmap = remember(selectedImageBytes) {
        selectedImageBytes?.let { bytes ->
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }
    }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Chemistry Vision Lab",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = "Select a photo of a handwritten Lewis/skeletal structure, textbook reaction diagram, or 3D molecular model to extract its SMILES and verify bonding.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            OutlinedButton(
                onClick = { imagePickerLauncher.launch("image/*") },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.AddPhotoAlternate, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(if (previewBitmap == null) "Choose Chemistry Image from Gallery" else "Replace Selected Image")
            }

            if (previewBitmap != null) {
                Image(
                    bitmap = previewBitmap,
                    contentDescription = "Selected chemistry diagram",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(210.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                )
            }

            OutlinedTextField(
                value = questionText,
                onValueChange = { questionText = it },
                label = { Text("Optional question (e.g. 'Check valence errors or stereochemistry')", fontSize = 12.sp) },
                modifier = Modifier.fillMaxWidth()
            )

            Button(
                enabled = selectedImageBytes != null && !isAnalyzing,
                onClick = {
                    val bytes = selectedImageBytes ?: return@Button
                    isAnalyzing = true
                    errorMsg = null
                    scope.launch {
                        try {
                            visionResult = GeminiChemService.analyzeChemistryImage(
                                imageBytes = bytes,
                                mimeType = selectedMimeType,
                                question = questionText.takeIf { it.isNotBlank() }
                            )
                        } catch (e: Exception) {
                            errorMsg = e.message ?: "Vision analysis failed."
                        } finally {
                            isAnalyzing = false
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isAnalyzing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = Color.White
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Analyzing Structure with Gemini...")
                } else {
                    Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Recognize Structure & Verify Valence")
                }
            }

            if (errorMsg != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = errorMsg.orEmpty(),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }

            val res = visionResult
            if (res != null) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = res.identifiedCompound,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        if (res.formula.isNotBlank()) {
                            Text(
                                text = "Formula: ${res.formula} • SMILES: ${res.extractedSmiles}",
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        Text(
                            text = res.structuralAnalysis,
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        if (res.functionalGroups.isNotEmpty()) {
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                res.functionalGroups.forEach { fg ->
                                    AssistChip(onClick = {}, label = { Text(fg, fontSize = 11.sp) })
                                }
                            }
                        }

                        if (res.correctionsOrNotes.isNotEmpty()) {
                            Text(
                                text = "Valence & Structural Notes",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold
                            )
                            res.correctionsOrNotes.forEach { note ->
                                Text("• $note", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }

                        if (res.extractedSmiles.isNotBlank()) {
                            Button(
                                onClick = {
                                    val ok = onLoadSmilesInWorkbench(
                                        res.extractedSmiles,
                                        res.identifiedCompound.ifBlank { "Vision Structure" }
                                    )
                                    if (!ok) {
                                        errorMsg = "Extracted SMILES '${res.extractedSmiles}' could not be parsed."
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Load in 2D / 3D Workbench")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PubChemScreen(
    onLoadCompound: (compound: PubChemCompound) -> Boolean,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var isSearching by remember { mutableStateOf(false) }
    var results by remember { mutableStateOf<List<PubChemCompound>>(emptyList()) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    val sampleQueries = listOf(
        "Aspirin",
        "Caffeine",
        "Ibuprofen",
        "Dopamine",
        "Glucose",
        "Vanillin",
        "Capsaicin"
    )

    fun runSearch(term: String) {
        val clean = term.trim()
        if (clean.isEmpty() || isSearching) return
        query = clean
        isSearching = true
        errorMsg = null
        scope.launch {
            try {
                results = PubChemService.searchByName(clean)
            } catch (e: Exception) {
                errorMsg = e.message ?: "PubChem lookup failed."
                results = emptyList()
            } finally {
                isSearching = false
            }
        }
    }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = "NIH PubChem Compound Lookup",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search compound name (e.g. Serotonin, Acetone)", fontSize = 12.sp) },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                Button(
                    enabled = query.isNotBlank() && !isSearching,
                    onClick = { runSearch(query) }
                ) {
                    if (isSearching) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = Color.White
                        )
                    } else {
                        Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Search", fontSize = 12.sp)
                    }
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                sampleQueries.forEach { sample ->
                    OutlinedButton(
                        onClick = { runSearch(sample) },
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                        modifier = Modifier.height(28.dp)
                    ) {
                        Text(sample, fontSize = 11.sp)
                    }
                }
            }

            if (errorMsg != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = errorMsg.orEmpty(),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }

            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(results, key = { it.cid }) { compound ->
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = compound.iupacName ?: "CID ${compound.cid}",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.weight(1f)
                                )
                                Text(
                                    text = "CID ${compound.cid}",
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Text(
                                text = "Formula: ${compound.molecularFormula ?: "—"} • MW: ${compound.molecularWeight ?: "—"} g/mol",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            if (!compound.smiles.isNullOrBlank()) {
                                Text(
                                    text = "SMILES: ${compound.smiles}",
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                            Spacer(Modifier.height(4.dp))
                            Button(
                                enabled = !compound.smiles.isNullOrBlank(),
                                onClick = {
                                    val ok = onLoadCompound(compound)
                                    if (!ok) {
                                        errorMsg = "Unsupported atom or SMILES syntax in CID ${compound.cid}."
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Load into Workbench", fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}
