import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(err: unknown): {
  status: number;
  message: string;
  code: string;
} {
  const raw = err instanceof Error ? err.message : String(err);
  if (/API_KEY_INVALID|API key not valid|401/i.test(raw)) {
    return {
      status: 400,
      code: 'API_KEY_INVALID',
      message:
        'The configured GEMINI_API_KEY was rejected. Please check or update your key in Settings > Secrets.',
    };
  }
  if (/PERMISSION_DENIED|403|billing|paid/i.test(raw)) {
    return {
      status: 403,
      code: 'PERMISSION_DENIED',
      message:
        'Permission denied for this Gemini model. Ensure your GEMINI_API_KEY in Settings > Secrets has billing/paid tier enabled for Pro, Argon, Image, and Omni models.',
    };
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(raw)) {
    return {
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      message:
        'Quota exhausted (429). If using a free-tier key with a paid model, select a billing-enabled API key in Settings > Secrets.',
    };
  }
  if (/NOT_FOUND|404/i.test(raw)) {
    return {
      status: 404,
      code: 'NOT_FOUND',
      message: `Requested Gemini model endpoint returned 404: ${raw.slice(0, 220)}`,
    };
  }
  return {
    status: 500,
    code: 'GEMINI_ERROR',
    message: raw.slice(0, 320) || 'Unexpected Gemini API error.',
  };
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  baseDelayMs = 600
): Promise<ResponseInit & { ok: boolean; status: number; statusText: string; text: () => Promise<string>; json: () => Promise<unknown> }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok) {
      return response;
    }
    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < maxRetries
    ) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      const delay =
        !Number.isNaN(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `HTTP ${response.status} (${response.statusText}) from ${url}: ${errorBody.slice(0, 300)}`
    );
  }
  throw new Error(`Exhausted retries for ${url}`);
}

function stripBase64Prefix(dataUrlOrBase64: string): {
  base64: string;
  mimeType: string;
} {
  const match = dataUrlOrBase64.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: 'image/png', base64: dataUrlOrBase64 };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const ai = getAiClient();
    res.json({
      ok: true,
      hasApiKey: Boolean(ai),
    });
  });

  // 1. Deep Theoretical Structure Analysis (gemini-4-argon for complex STEM reasoning)
  app.post('/api/chem/analyze-structure', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(400).json({
        code: 'API_KEY_MISSING',
        error:
          'GEMINI_API_KEY is not configured. Open Settings > Secrets to set your Gemini API key.',
      });
      return;
    }

    try {
      const { name, formula, smiles, molecularWeight, valenceWarnings, hybridizationCounts } =
        req.body ?? {};

      const prompt = `Analyze this theoretical molecular structure drawn by a chemistry student:
- Name / Label: ${name || 'Untitled Structure'}
- Molecular Formula: ${formula || 'Unknown'}
- SMILES: ${smiles || 'None'}
- Molecular Weight: ${molecularWeight ?? 'Unknown'} g/mol
- Hybridization Counts: sp3=${hybridizationCounts?.sp3 ?? 0}, sp2=${hybridizationCounts?.sp2 ?? 0}, sp=${hybridizationCounts?.sp ?? 0}
- Valence Warnings Detected: ${Array.isArray(valenceWarnings) && valenceWarnings.length > 0 ? valenceWarnings.join('; ') : 'None'}

Provide a rigorous theoretical chemistry evaluation including IUPAC identification, 3D VSEPR & conformational strain analysis, electronic/resonance effects, key functional groups, predicted IR/NMR diagnostic bands, and actionable structural optimization suggestions.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-argon',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          systemInstruction:
            'You are a computational and physical organic chemistry professor evaluating a student-drawn theoretical molecule. Be scientifically accurate, concise, and pedagogical.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              iupacName: { type: Type.STRING },
              commonName: { type: Type.STRING },
              stabilityVerdict: { type: Type.STRING },
              vseprAndConformation: { type: Type.STRING },
              electronicAndResonance: { type: Type.STRING },
              functionalGroups: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              predictedSpectroscopy: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              optimizationSuggestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              'iupacName',
              'commonName',
              'stabilityVerdict',
              'vseprAndConformation',
              'electronicAndResonance',
              'functionalGroups',
              'predictedSpectroscopy',
              'optimizationSuggestions',
            ],
          },
        },
      });

      const text = (response.text ?? '{}').trim();
      const parsed = JSON.parse(text);
      res.json({ model: 'gemini-4-argon', analysis: parsed });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // 2. Natural-Language to 2D/3D Molecule Synthesizer (gemini-3.8-flash)
  app.post('/api/chem/synthesize-molecule', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(400).json({
        code: 'API_KEY_MISSING',
        error:
          'GEMINI_API_KEY is not configured. Open Settings > Secrets to set your Gemini API key.',
      });
      return;
    }

    try {
      const { prompt, currentSmiles } = req.body ?? {};
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
      }

      const fullPrompt = currentSmiles
        ? `Current molecule SMILES: ${currentSmiles}\nStudent request: ${prompt}\nGenerate the resulting or requested molecule as a clean, valid canonical SMILES using standard organic subset symbols (B, C, N, O, P, S, F, Cl, Br, I, c, n, o, s) with valid ring closures and balanced valences.`
        : `Student request: ${prompt}\nGenerate the requested molecule as a clean, valid canonical SMILES using standard organic subset symbols (B, C, N, O, P, S, F, Cl, Br, I, c, n, o, s) with valid ring closures and balanced valences.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: fullPrompt,
        config: {
          systemInstruction:
            'You are a cheminformatics structure synthesizer. Return a valid, chemically accurate SMILES string without stereochemical @ slashes if unnecessary, plus compound name and brief structural summary.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              iupacName: { type: Type.STRING },
              smiles: { type: Type.STRING },
              geometrySummary: { type: Type.STRING },
            },
            required: ['name', 'iupacName', 'smiles', 'geometrySummary'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({ model: 'gemini-3.8-flash', result: parsed });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // 3. Fast Atom / Orbital Quick-Hint (gemini-3.1-flash-lite for low-latency micro-hints)
  app.post('/api/chem/quick-hint', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(400).json({
        code: 'API_KEY_MISSING',
        error:
          'GEMINI_API_KEY is not configured. Open Settings > Secrets to set your Gemini API key.',
      });
      return;
    }

    try {
      const { element, hybridization, vseprGeometry, moleculeName, smiles } =
        req.body ?? {};
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: `In 2 concise sentences for a chemistry student, explain the bonding role, orbital hybridization (${hybridization}), and ${vseprGeometry} local geometry of this ${element} atom inside ${moleculeName || 'the molecule'} (SMILES: ${smiles || 'N/A'}).`,
      });
      res.json({
        model: 'gemini-3.1-flash-lite',
        hint: (response.text ?? '').trim(),
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // 4. Multi-Turn Chemistry Lab Tutor Chatbot (gemini-4-argon, gemini-3.8-flash, gemini-3.1-flash-lite)
  app.post('/api/chat', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(400).json({
        code: 'API_KEY_MISSING',
        error:
          'GEMINI_API_KEY is not configured. Open Settings > Secrets to set your Gemini API key.',
      });
      return;
    }

    try {
      const { messages, model, moleculeContext } = req.body ?? {};
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'Messages array is required.' });
        return;
      }

      const allowedModels = new Set([
        'gemini-4-argon',
        'gemini-3.8-flash',
        'gemini-3.1-flash-lite',
      ]);
      const selectedModel = allowedModels.has(model)
        ? String(model)
        : 'gemini-3.8-flash';

      const systemInstruction = `You are ValenceLab Tutor, an expert theoretical and organic chemistry laboratory mentor helping a student draw 2D molecules and explore their 3D VSEPR geometries.
Active Workbench Molecule Context:
- Name: ${moleculeContext?.name ?? 'None'}
- Formula: ${moleculeContext?.formula ?? 'N/A'}
- Molar Mass: ${moleculeContext?.molecularWeight ?? 'N/A'} g/mol
- SMILES: ${moleculeContext?.smiles ?? 'N/A'}
- Valence Status: ${moleculeContext?.valenceValid ? 'Valid' : `Warnings: ${(moleculeContext?.valenceWarnings ?? []).join(', ')}`}

Guidelines:
1. Explain orbital hybridization (sp3, sp2, sp), VSEPR bond angles, resonance, polarity, and reaction mechanisms clearly.
2. Whenever you propose a specific molecule or structural modification for the student to visualize in 3D, include a standalone line formatted exactly as:
SMILES: <valid_smiles_here>
so the student can load it into the 3D workbench with one click.`;

      const priorHistory = messages.slice(0, -1).map((m: { role: string; content: string }) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(m.content || '') }],
      }));

      const latestMessage = String(messages[messages.length - 1]?.content || '');

      const chat = ai.chats.create({
        model: selectedModel,
        history: priorHistory,
        config: {
          systemInstruction,
        },
      });

      const response = await chat.sendMessage({
        message: latestMessage,
      });

      const replyText = (response.text ?? '').trim();
      const smilesMatch = replyText.match(/^SMILES:\s*([^\s]+)\s*$/m);

      res.json({
        model: selectedModel,
        reply: replyText,
        suggestedSmiles: smilesMatch ? smilesMatch[1] : null,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // 5. Image Understanding & Structure Extraction (gemini-4-argon)
  app.post('/api/vision/analyze-image', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(400).json({
        code: 'API_KEY_MISSING',
        error:
          'GEMINI_API_KEY is not configured. Open Settings > Secrets to set your Gemini API key.',
      });
      return;
    }

    try {
      const { imageData, question } = req.body ?? {};
      if (!imageData || typeof imageData !== 'string') {
        res.status(400).json({ error: 'Uploaded image data is required.' });
        return;
      }

      const { base64, mimeType } = stripBase64Prefix(imageData);

      const promptText =
        question && typeof question === 'string' && question.trim().length > 0
          ? `Analyze this chemistry image and answer the student's question: "${question}". Identify any chemical structures, hand-drawn Lewis/skeletal formulas, 3D ball-and-stick models, or laboratory apparatus, check for valence/bonding errors, and provide a valid SMILES string if a primary molecule is depicted.`
          : 'Analyze this chemistry image (hand-drawn chemical structure, textbook diagram, 3D molecular model, or lab photo). Identify the chemical compound(s), functional groups, hybridization, stereochemistry, any structural/valence errors in the drawing, and extract a valid canonical SMILES string for the main molecule so the student can load it into the 3D workbench.';

      const response = await ai.models.generateContent({
        model: 'gemini-4-argon',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
            {
              text: promptText,
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              identifiedCompound: { type: Type.STRING },
              formula: { type: Type.STRING },
              extractedSmiles: { type: Type.STRING },
              structuralAnalysis: { type: Type.STRING },
              functionalGroups: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              correctionsOrNotes: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              'identifiedCompound',
              'formula',
              'extractedSmiles',
              'structuralAnalysis',
              'functionalGroups',
              'correctionsOrNotes',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({
        model: 'gemini-4-argon',
        analysis: parsed,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // 6. High-Quality Image Generation with Size (1K, 2K, 4K) & Aspect Ratio Control
  app.post('/api/media/generate-image', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(400).json({
        code: 'API_KEY_MISSING',
        error:
          'GEMINI_API_KEY is not configured. Open Settings > Secrets to set your Gemini API key.',
      });
      return;
    }

    try {
      const { prompt, model, aspectRatio, imageSize } = req.body ?? {};
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Image prompt is required.' });
        return;
      }

      const allowedModels = new Set([
        'gemini-3-pro-image-preview',
        'gemini-nano-banana-2.1',
      ]);
      const selectedModel = allowedModels.has(model)
        ? String(model)
        : 'gemini-3-pro-image-preview';

      const allowedRatios = new Set([
        '1:1',
        '2:3',
        '3:2',
        '3:4',
        '4:3',
        '9:16',
        '16:9',
        '21:9',
      ]);
      const validRatio = allowedRatios.has(aspectRatio) ? String(aspectRatio) : '1:1';

      const allowedSizes = new Set(['1K', '2K', '4K']);
      const validSize = allowedSizes.has(imageSize) ? String(imageSize) : '1K';

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: {
          parts: [
            {
              text: prompt,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: validRatio,
            imageSize: validSize,
          },
        },
      });

      let imageUrl: string | null = null;
      let caption = '';

      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType ?? 'image/png';
          imageUrl = `data:${mime};base64,${part.inlineData.data}`;
        } else if (part.text) {
          caption += part.text;
        }
      }

      if (!imageUrl) {
        res.status(502).json({
          error: 'No image data returned from Gemini image model.',
        });
        return;
      }

      res.json({
        model: selectedModel,
        aspectRatio: validRatio,
        imageSize: validSize,
        imageUrl,
        caption: caption.trim(),
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // 7. Image-to-Video Animation via Gemini Interactions API (gemini-omni-1.2-flash)
  app.post('/api/media/animate-video', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(400).json({
        code: 'API_KEY_MISSING',
        error:
          'GEMINI_API_KEY is not configured. Open Settings > Secrets to set your Gemini API key.',
      });
      return;
    }

    try {
      const { imageData, prompt, aspectRatio, previousInteractionId } =
        req.body ?? {};

      const validRatio = aspectRatio === '9:16' ? '9:16' : '16:9';
      const motionPrompt =
        typeof prompt === 'string' && prompt.trim().length > 0
          ? prompt.trim()
          : 'Smooth scientific 3D molecular orbital rotation with subtle bond vibrations and crisp studio laboratory lighting.';

      let interaction;

      if (previousInteractionId && typeof previousInteractionId === 'string') {
        interaction = await ai.interactions.create(
          {
            model: 'gemini-omni-1.2-flash',
            previous_interaction_id: previousInteractionId,
            input: motionPrompt,
            background: false,
            store: true,
            stream: false,
            response_format: {
              type: 'video',
              aspect_ratio: validRatio,
            },
          },
          { timeout: 300000 }
        );
      } else {
        if (!imageData || typeof imageData !== 'string') {
          res.status(400).json({
            error: 'An uploaded image or 3D snapshot is required to animate into video.',
          });
          return;
        }
        const { base64, mimeType } = stripBase64Prefix(imageData);

        interaction = await ai.interactions.create(
          {
            model: 'gemini-omni-1.2-flash',
            input: [
              {
                type: 'image',
                mime_type: mimeType,
                data: base64,
              },
              {
                type: 'text',
                text: motionPrompt,
              },
            ],
            background: false,
            store: true,
            stream: false,
            response_format: {
              type: 'video',
              aspect_ratio: validRatio,
            },
          },
          { timeout: 300000 }
        );
      }

      // Poll if the interaction is still processing
      while (
        interaction.status &&
        interaction.status !== 'completed' &&
        !['failed', 'cancelled'].includes(interaction.status)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        interaction = await ai.interactions.get(interaction.id);
      }

      if (interaction.status === 'failed' || interaction.status === 'cancelled') {
        res.status(500).json({
          error: `Video generation ended with status: ${interaction.status}`,
        });
        return;
      }

      const videoPart = interaction.output_video;
      if (!videoPart) {
        res.status(502).json({
          error: 'Video interaction completed but no output_video was returned.',
        });
        return;
      }

      const videoMime = videoPart.mime_type || 'video/mp4';
      let videoUrl: string | null = null;

      if (videoPart.data) {
        videoUrl = `data:${videoMime};base64,${videoPart.data}`;
      } else if (videoPart.uri) {
        const apiKey = process.env.GEMINI_API_KEY?.trim() || '';
        const fetched = await fetch(videoPart.uri, {
          headers: { 'x-goog-api-key': apiKey },
        });
        if (fetched.ok) {
          const arr = Buffer.from(await fetched.arrayBuffer());
          videoUrl = `data:${videoMime};base64,${arr.toString('base64')}`;
        } else {
          videoUrl = videoPart.uri;
        }
      }

      res.json({
        model: 'gemini-omni-1.2-flash',
        interactionId: interaction.id,
        aspectRatio: validRatio,
        videoUrl,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        code: formatted.code,
        error: formatted.message,
      });
    }
  });

  // 8. PubChem Compound Lookup Proxy (Real Scientific Database Integration)
  app.get('/api/pubchem/search', async (req: Request, res: Response) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
      res.status(400).json({ error: 'Search query "q" is required.' });
      return;
    }

    try {
      const encoded = encodeURIComponent(query);
      const propUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/property/IUPACName,MolecularFormula,MolecularWeight,CanonicalSMILES,ConnectivitySMILES,IsomericSMILES,InChIKey,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount,Complexity/JSON`;
      const resp = await fetchWithRetry(propUrl);
      const data = (await resp.json()) as {
        PropertyTable?: { Properties?: Record<string, unknown>[] };
      };
      const props = data?.PropertyTable?.Properties ?? [];
      res.json({ results: props.slice(0, 6) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PubChem lookup failed.';
      res.status(404).json({ error: msg });
    }
  });

  // Mount Vite middleware in development or serve built dist in production
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ValenceLab server running on http://localhost:${PORT}`);
  });
}

startServer();
