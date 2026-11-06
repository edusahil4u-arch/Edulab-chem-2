import React, { useState } from 'react';
import {
  Camera,
  Download,
  Film,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { MoleculeGraph, MoleculeMetrics } from '../chem/types';

type ImageModelId = 'gemini-3-pro-image-preview' | 'gemini-nano-banana-2.1';
type ImageSizeOption = '1K' | '2K' | '4K';
type AspectRatioOption =
  | '1:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '9:16'
  | '16:9'
  | '21:9';
type VideoAspectRatioOption = '16:9' | '9:16';

const IMAGE_SIZES: ImageSizeOption[] = ['1K', '2K', '4K'];
const ASPECT_RATIOS: AspectRatioOption[] = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '21:9',
];

interface MediaStudioViewProps {
  molecule: MoleculeGraph;
  metrics: MoleculeMetrics;
  latestSnapshotUrl: string | null;
}

export const MediaStudioView: React.FC<MediaStudioViewProps> = ({
  molecule,
  metrics,
  latestSnapshotUrl,
}) => {
  // Image Generation State
  const [imagePrompt, setImagePrompt] = useState(
    `Scientific studio 3D molecular visualization of ${molecule.name} (${metrics.formula}), translucent glass electron density cloud around precision metallic ball-and-stick bonds on a clean alabaster optical bench, crisp editorial lighting`
  );
  const [imageModel, setImageModel] = useState<ImageModelId>(
    'gemini-3-pro-image-preview'
  );
  const [imageSize, setImageSize] = useState<ImageSizeOption>('1K');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('1:1');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(
    null
  );
  const [imageError, setImageError] = useState<string | null>(null);

  // Image-to-Video Animation State (gemini-omni-1.2-flash Interactions API)
  const [videoSourceImage, setVideoSourceImage] = useState<string | null>(
    latestSnapshotUrl
  );
  const [videoPrompt, setVideoPrompt] = useState(
    `Smooth 360-degree scientific camera orbit around ${molecule.name} showing subtle harmonic bond stretching and crisp studio reflections`
  );
  const [videoAspectRatio, setVideoAspectRatio] =
    useState<VideoAspectRatioOption>('16:9');
  const [isAnimatingVideo, setIsAnimatingVideo] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(
    null
  );
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  const [videoError, setVideoError] = useState<string | null>(null);

  const handlePopulateFromMolecule = () => {
    setImagePrompt(
      `High-resolution scientific publication render of ${molecule.name} (${metrics.formula}, SMILES ${metrics.canonicalSmiles}), showcasing ${metrics.hybridizationCounts.sp2} sp2 planar centers and ${metrics.hybridizationCounts.sp3} sp3 tetrahedral nodes, subtle electron orbital lobes on an illuminated white laboratory stage`
    );
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim() || isGeneratingImage) return;
    setIsGeneratingImage(true);
    setImageError(null);
    try {
      const res = await fetch('/api/media/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imagePrompt.trim(),
          model: imageModel,
          imageSize,
          aspectRatio,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Image generation failed.');
      }
      setGeneratedImageUrl(data.imageUrl);
    } catch (err) {
      setImageError(
        err instanceof Error ? err.message : 'Unable to generate image.'
      );
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleVideoImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setVideoSourceImage(reader.result);
        setGeneratedVideoUrl(null);
        setInteractionId(null);
        setVideoError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAnimateVideo = async (isExtension = false) => {
    const promptToSend = isExtension
      ? followUpPrompt.trim()
      : videoPrompt.trim();
    if (!promptToSend || isAnimatingVideo) return;
    if (!isExtension && !videoSourceImage) return;

    setIsAnimatingVideo(true);
    setVideoError(null);
    try {
      const res = await fetch('/api/media/animate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isExtension && interactionId
            ? {
                previousInteractionId: interactionId,
                prompt: promptToSend,
                aspectRatio: videoAspectRatio,
              }
            : {
                imageData: videoSourceImage,
                prompt: promptToSend,
                aspectRatio: videoAspectRatio,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Video animation failed.');
      }
      setGeneratedVideoUrl(data.videoUrl);
      setInteractionId(data.interactionId ?? null);
      if (isExtension) {
        setFollowUpPrompt('');
      }
    } catch (err) {
      setVideoError(
        err instanceof Error ? err.message : 'Unable to animate image into video.'
      );
    } finally {
      setIsAnimatingVideo(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* Left Column: High-Quality Image Generation (Size & Aspect Ratio Control) */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-xs p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-blue-600 shrink-0" />
            <h1 className="text-sm font-semibold text-slate-900">
              Molecular Publication Image Studio
            </h1>
          </div>
          <button
            type="button"
            onClick={handlePopulateFromMolecule}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Sync Active Molecule ({molecule.name})
          </button>
        </div>

        {/* Model Selector: Pro vs General */}
        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            Image Generation Model
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setImageModel('gemini-3-pro-image-preview')}
              className={`p-2.5 rounded-lg border text-left transition-colors ${
                imageModel === 'gemini-3-pro-image-preview'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
              }`}
            >
              <div className="text-xs font-semibold">Gemini 3 Pro Image</div>
              <div
                className={`text-[11px] font-mono mt-0.5 ${
                  imageModel === 'gemini-3-pro-image-preview'
                    ? 'text-slate-300'
                    : 'text-slate-500'
                }`}
              >
                gemini-3-pro-image-preview
              </div>
            </button>

            <button
              type="button"
              onClick={() => setImageModel('gemini-nano-banana-2.1')}
              className={`p-2.5 rounded-lg border text-left transition-colors ${
                imageModel === 'gemini-nano-banana-2.1'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
              }`}
            >
              <div className="text-xs font-semibold">Nano Banana 2.1</div>
              <div
                className={`text-[11px] font-mono mt-0.5 ${
                  imageModel === 'gemini-nano-banana-2.1'
                    ? 'text-slate-300'
                    : 'text-slate-500'
                }`}
              >
                gemini-nano-banana-2.1
              </div>
            </button>
          </div>
        </div>

        {/* Image Size & Aspect Ratio Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-4">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Resolution Size
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {IMAGE_SIZES.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setImageSize(sz)}
                  className={`py-1.5 rounded-md font-mono text-xs font-semibold transition-colors tabular-nums ${
                    imageSize === sz
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:col-span-8">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Aspect Ratio
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setAspectRatio(ratio)}
                  className={`py-1.5 rounded-md font-mono text-xs font-medium transition-colors tabular-nums ${
                    aspectRatio === ratio
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Prompt Textarea */}
        <div>
          <label
            htmlFor="media-image-prompt"
            className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5"
          >
            Scientific Scene Prompt
          </label>
          <textarea
            id="media-image-prompt"
            rows={3}
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 leading-relaxed"
          />
        </div>

        <button
          type="button"
          onClick={handleGenerateImage}
          disabled={isGeneratingImage || !imagePrompt.trim()}
          className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {isGeneratingImage ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          <span>
            {isGeneratingImage
              ? `Rendering ${imageSize} (${aspectRatio})...`
              : `Generate ${imageSize} Illustration (${aspectRatio})`}
          </span>
        </button>

        {imageError && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed">
            {imageError}
          </div>
        )}

        {/* Output Preview */}
        <div className="border border-slate-200 rounded-lg bg-slate-50 min-h-[240px] flex flex-col items-center justify-center p-3">
          {generatedImageUrl ? (
            <div className="w-full space-y-3">
              <div className="flex items-center justify-center bg-white border border-slate-200 rounded-md p-2 overflow-hidden">
                <img
                  src={generatedImageUrl}
                  alt="Generated molecular illustration"
                  className="max-h-[320px] w-auto object-contain rounded"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <a
                  href={generatedImageUrl}
                  download={`${molecule.name.toLowerCase().replace(/\s+/g, '-')}-${imageSize}.png`}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-medium flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PNG</span>
                </a>

                <button
                  type="button"
                  onClick={() => {
                    setVideoSourceImage(generatedImageUrl);
                    setGeneratedVideoUrl(null);
                    setInteractionId(null);
                  }}
                  className="px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-medium flex items-center gap-1.5"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Send to Video Animator</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 space-y-1">
              <ImageIcon className="w-6 h-6 text-slate-400 mx-auto" />
              <p className="text-xs text-slate-500">
                Select size ({imageSize}) and aspect ratio ({aspectRatio}) to render high-resolution molecular artwork
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Right Column: Image-to-Video Animation (gemini-omni-1.2-flash Interactions API) */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-xs p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-blue-600 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Image-to-Video Molecular Animator
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            gemini-omni-1.2-flash
          </span>
        </div>

        {/* Source Image Picker */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center gap-1.5 cursor-pointer transition-colors">
            <ImagePlus className="w-3.5 h-3.5 text-blue-600" />
            <span>Upload Starting Photo</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleVideoImageUpload}
              className="hidden"
            />
          </label>

          {latestSnapshotUrl && (
            <button
              type="button"
              onClick={() => {
                setVideoSourceImage(latestSnapshotUrl);
                setGeneratedVideoUrl(null);
                setInteractionId(null);
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 flex items-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Use 3D Snapshot</span>
            </button>
          )}

          {generatedImageUrl && (
            <button
              type="button"
              onClick={() => {
                setVideoSourceImage(generatedImageUrl);
                setGeneratedVideoUrl(null);
                setInteractionId(null);
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 flex items-center gap-1.5"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Use Generated Render</span>
            </button>
          )}
        </div>

        {/* Video Aspect Ratio Selector: Landscape (16:9) vs Portrait (9:16) */}
        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            Video Orientation &amp; Aspect Ratio
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setVideoAspectRatio('16:9')}
              className={`py-2 px-3 rounded-lg border font-mono text-xs font-semibold transition-colors tabular-nums ${
                videoAspectRatio === '16:9'
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              16:9 Landscape
            </button>
            <button
              type="button"
              onClick={() => setVideoAspectRatio('9:16')}
              className={`py-2 px-3 rounded-lg border font-mono text-xs font-semibold transition-colors tabular-nums ${
                videoAspectRatio === '9:16'
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              9:16 Portrait
            </button>
          </div>
        </div>

        {/* Source Frame Thumbnail */}
        <div className="border border-slate-200 rounded-lg bg-slate-50 p-2.5 flex items-center gap-3">
          {videoSourceImage ? (
            <>
              <img
                src={videoSourceImage}
                alt="Starting frame for video animation"
                className="w-20 h-16 object-cover rounded border border-slate-200 bg-white shrink-0"
              />
              <div className="text-xs text-slate-700 min-w-0">
                <div className="font-semibold text-slate-900">
                  Starting Reference Frame Loaded
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Ready to animate into {videoAspectRatio} video
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-500 py-2">
              Upload a photo or select a 3D snapshot above to animate into video.
            </div>
          )}
        </div>

        {/* Motion Prompt */}
        <div>
          <label
            htmlFor="media-video-prompt"
            className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5"
          >
            Motion &amp; Camera Direction
          </label>
          <textarea
            id="media-video-prompt"
            rows={2}
            value={videoPrompt}
            onChange={(e) => setVideoPrompt(e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 leading-relaxed"
          />
        </div>

        <button
          type="button"
          onClick={() => handleAnimateVideo(false)}
          disabled={!videoSourceImage || isAnimatingVideo}
          className="w-full py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {isAnimatingVideo ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Wand2 className="w-4 h-4" />
          )}
          <span>
            {isAnimatingVideo
              ? `Generating ${videoAspectRatio} Video...`
              : `Animate Image into ${videoAspectRatio} Video`}
          </span>
        </button>

        {videoError && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed">
            {videoError}
          </div>
        )}

        {/* Video Player & Multi-Turn Extension */}
        <div className="border border-slate-200 rounded-lg bg-slate-50 min-h-[220px] flex flex-col items-center justify-center p-3">
          {generatedVideoUrl ? (
            <div className="w-full space-y-3">
              <video
                src={generatedVideoUrl}
                controls
                autoPlay
                loop
                playsInline
                className="w-full max-h-[300px] rounded-md bg-slate-950"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <a
                  href={generatedVideoUrl}
                  download={`${molecule.name.toLowerCase().replace(/\s+/g, '-')}-animation.mp4`}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-medium flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download MP4</span>
                </a>
                {interactionId && (
                  <span className="font-mono text-[11px] text-slate-500">
                    Session ready for extension
                  </span>
                )}
              </div>

              {interactionId && (
                <div className="pt-2 border-t border-slate-200 flex items-center gap-2">
                  <input
                    type="text"
                    value={followUpPrompt}
                    onChange={(e) => setFollowUpPrompt(e.target.value)}
                    placeholder="Extend or edit video (e.g., zoom in on the carbonyl oxygen)..."
                    className="flex-1 bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => handleAnimateVideo(true)}
                    disabled={isAnimatingVideo || !followUpPrompt.trim()}
                    className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
                  >
                    Extend
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 space-y-1">
              <Film className="w-6 h-6 text-slate-400 mx-auto" />
              <p className="text-xs text-slate-500">
                Generated {videoAspectRatio} molecular motion video will appear here
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
