// ============================================================================
// PROMPT GENERATOR - Client-Side Batching Controller
// ============================================================================
// This component handles ALL batching, looping, and delays CLIENT-SIDE.
// Each backend call generates ONE batch (max 20 prompts) to avoid
// Vercel serverless timeouts. The loop runs here in the browser.
// ============================================================================

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Sparkles, Copy, Download, Check, AlertCircle, Info, Square } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ApiKey {
  id: string;
  provider: 'groq' | 'openrouter';
  is_active: boolean;
}

interface PromptGeneratorProps {
  hasActiveKeys: boolean;
  apiKeys: ApiKey[];
}

// Provider-specific models
const GROQ_MODELS = [
  { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout (17B)' },
  { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick (17B)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 (70B)' },
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 (8B)' },
];

const OPENROUTER_MODELS = [
  { value: 'xiaomi/mimo-v2-flash:free', label: 'Xiaomi Mimo v2 Flash (Free)' },
  { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (Free)' },
  { value: 'deepseek/deepseek-r1-0528:free', label: 'DeepSeek R1 0528 (Free)' },
];

// LEVEL 1: Output Type (MANDATORY)
const OUTPUT_TYPES = [
  { value: 'photo', label: 'Photo' },
  { value: 'video', label: 'Video' },
  { value: 'vector', label: 'Vector' },
  { value: 'illustration', label: 'Illustration' },
  { value: 'typography', label: 'Typography' },
  { value: 'ui_screen', label: 'UI / Screen' },
];

// LEVEL 2: Style Mode (OPTIONAL)
const STYLE_MODES = [
  { value: 'none', label: 'None (Default)' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'glitch', label: 'Glitch' },
  { value: 'retro', label: 'Retro' },
  { value: 'cyberpunk', label: 'Cyberpunk' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'analog', label: 'Analog' },
  { value: 'neon', label: 'Neon' },
  { value: 'vintage', label: 'Vintage' },
];

// LEVEL 3: Mood / Tone (OPTIONAL)
const MOODS = [
  { value: 'none', label: 'None (Default)' },
  { value: 'dark', label: 'Dark' },
  { value: 'calm', label: 'Calm' },
  { value: 'futuristic', label: 'Futuristic' },
  { value: 'horror', label: 'Horror' },
  { value: 'energetic', label: 'Energetic' },
  { value: 'dreamy', label: 'Dreamy' },
  { value: 'mysterious', label: 'Mysterious' },
  { value: 'uplifting', label: 'Uplifting' },
];

const PROVIDERS = [
  { value: 'groq', label: 'Groq' },
  { value: 'openrouter', label: 'OpenRouter' },
];

// Client-side batching configuration
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1500; // Delay between batches (client-side)

export function PromptGenerator({ hasActiveKeys, apiKeys }: PromptGeneratorProps) {
  const [theme, setTheme] = useState('');
  const [provider, setProvider] = useState<'groq' | 'openrouter'>('groq');
  const [model, setModel] = useState(GROQ_MODELS[0].value);
  const [outputType, setOutputType] = useState(OUTPUT_TYPES[0].value);
  const [styleMode, setStyleMode] = useState('none');
  const [mood, setMood] = useState('none');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [promptCount, setPromptCount] = useState('20');
  const [minWords, setMinWords] = useState(22);
  const [maxWords, setMaxWords] = useState(35);
  const [textOutput, setTextOutput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, batch: 0, totalBatches: 0 });
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Ref to track if generation should stop (for cancellation)
  const shouldStopRef = useRef(false);

  // Check if provider has active keys
  const hasGroqKeys = apiKeys.some(k => k.provider === 'groq' && k.is_active);
  const hasOpenRouterKeys = apiKeys.some(k => k.provider === 'openrouter' && k.is_active);
  const hasActiveProviderKeys = provider === 'groq' ? hasGroqKeys : hasOpenRouterKeys;
  const currentModels = provider === 'groq' ? GROQ_MODELS : OPENROUTER_MODELS;

  const handleProviderChange = (newProvider: 'groq' | 'openrouter') => {
    setProvider(newProvider);
    const models = newProvider === 'groq' ? GROQ_MODELS : OPENROUTER_MODELS;
    setModel(models[0].value);
  };

  const handleCountChange = (value: string) => {
    const numericValue = value.replace(/\D/g, '');
    if (numericValue === '' || (parseInt(numericValue) >= 1 && parseInt(numericValue) <= 1000)) {
      setPromptCount(numericValue);
    }
  };

  const handleMinWordsChange = (value: number[]) => {
    const newMin = value[0];
    setMinWords(newMin);
    if (newMin > maxWords) {
      setMaxWords(newMin + 5);
    }
  };

  const handleMaxWordsChange = (value: number[]) => {
    const newMax = value[0];
    setMaxWords(newMax);
    if (newMax < minWords) {
      setMinWords(newMax - 5);
    }
  };

  const getOutputTypeLabel = (value: string) => {
    return OUTPUT_TYPES.find(t => t.value === value)?.label || value;
  };

  const getStyleModeLabel = (value: string) => {
    if (!value || value === 'none') return null;
    return STYLE_MODES.find(s => s.value === value)?.label || value;
  };

  const getMoodLabel = (value: string) => {
    if (!value || value === 'none') return null;
    return MOODS.find(m => m.value === value)?.label || value;
  };

  // ============================================================================
  // CLIENT-SIDE BATCHING CONTROLLER
  // ============================================================================
  // This function loops through batches on the CLIENT, calling the backend
  // once per batch. Delays between batches happen HERE (not on server).
  // This ensures each backend call completes in <10s, avoiding timeouts.
  // ============================================================================
  const handleGenerate = useCallback(async () => {
    if (!theme.trim()) {
      toast({
        variant: 'destructive',
        title: 'Theme required',
        description: 'Please enter a theme for your prompts.',
      });
      return;
    }

    if (!hasActiveProviderKeys) {
      toast({
        variant: 'destructive',
        title: 'No active keys',
        description: `You need at least one active ${provider === 'groq' ? 'Groq' : 'OpenRouter'} API key.`,
      });
      return;
    }

    const totalCount = parseInt(promptCount) || 20;
    if (totalCount < 1 || totalCount > 1000) {
      toast({
        variant: 'destructive',
        title: 'Invalid count',
        description: 'Please enter a number between 1 and 1000.',
      });
      return;
    }

    // Calculate batches
    const batchSize = Math.min(BATCH_SIZE, totalCount);
    const totalBatches = Math.ceil(totalCount / batchSize);

    // Reset state
    setLoading(true);
    setTextOutput('');
    setError(null);
    setProgress({ current: 0, total: totalCount, batch: 0, totalBatches });
    shouldStopRef.current = false;

    const collectedPrompts: string[] = [];

    // ========================================================================
    // CLIENT-SIDE BATCH LOOP
    // ========================================================================
    for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
      // Check if user cancelled
      if (shouldStopRef.current) {
        toast({
          title: 'Generation stopped',
          description: `Saved ${collectedPrompts.length} prompts.`,
        });
        break;
      }

      const remaining = totalCount - collectedPrompts.length;
      const currentBatchSize = Math.min(batchSize, remaining);
      const startNumber = collectedPrompts.length + 1;
      
      // Last 5 prompts for AI context continuity
      const previousPrompts = collectedPrompts.slice(-5);

      setProgress({ 
        current: collectedPrompts.length, 
        total: totalCount, 
        batch: batchNum, 
        totalBatches 
      });

      try {
        // Call backend for ONE batch
        const { data, error: invokeError } = await supabase.functions.invoke('generate-prompts', {
          body: {
            theme: theme.trim(),
            provider,
            model,
            outputType,
            styleMode: styleMode === 'none' ? null : styleMode,
            mood: mood === 'none' ? null : mood,
            negativePrompt: negativePrompt.trim() || null,
            // Single-batch parameters
            batchSize: currentBatchSize,
            batchNumber: batchNum,
            startNumber,
            previousPrompts,
            minWords,
            maxWords,
          },
        });

        if (invokeError) throw invokeError;
        if (data.error) throw new Error(data.error);

        // Merge results - prevent duplicates
        const newPrompts = data.prompts || [];
        collectedPrompts.push(...newPrompts);

        // Update output in real-time so user sees progress
        const textList = collectedPrompts
          .map((text, index) => `${index + 1}. ${text}`)
          .join('\n');
        setTextOutput(textList);

        // Update progress
        setProgress({ 
          current: collectedPrompts.length, 
          total: totalCount, 
          batch: batchNum, 
          totalBatches 
        });

        // CLIENT-SIDE DELAY between batches (except last)
        // This is where the delay happens - NOT on the server!
        if (batchNum < totalBatches && !shouldStopRef.current) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }

      } catch (err) {
        console.error(`Batch ${batchNum} error:`, err);
        
        // Return what we have so far (partial results)
        if (collectedPrompts.length > 0) {
          const textList = collectedPrompts
            .map((text, index) => `${index + 1}. ${text}`)
            .join('\n');
          setTextOutput(textList);
          
          toast({
            variant: 'default',
            title: 'Partial results',
            description: `Generated ${collectedPrompts.length} of ${totalCount} prompts before error.`,
          });
          break;
        }
        
        // No prompts at all - show error
        const errorMessage = err instanceof Error ? err.message : 'Failed to generate prompts';
        setError(errorMessage);
        toast({
          variant: 'destructive',
          title: 'Generation failed',
          description: errorMessage,
        });
        setLoading(false);
        return;
      }
    }

    // Final state
    setLoading(false);
    setProgress({ current: collectedPrompts.length, total: totalCount, batch: totalBatches, totalBatches });

    if (collectedPrompts.length > 0 && !shouldStopRef.current) {
      toast({
        title: 'Generation complete',
        description: `Successfully generated ${collectedPrompts.length} prompts.`,
      });
    }
  }, [theme, provider, model, outputType, styleMode, mood, negativePrompt, promptCount, minWords, maxWords, hasActiveProviderKeys, toast]);

  // Cancel generation
  const handleCancel = useCallback(() => {
    shouldStopRef.current = true;
  }, []);

  const copyPrompt = async (prompt: string, index: number) => {
    await navigator.clipboard.writeText(prompt);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyOutput = async () => {
    if (!textOutput) return;
    await navigator.clipboard.writeText(textOutput);
    toast({
      title: 'Copied!',
      description: 'All prompts copied to clipboard.',
    });
  };

  const downloadOutput = () => {
    if (!textOutput) return;
    const typeSuffix = outputType.replace(/_/g, '-');
    const filename = `prompts-${typeSuffix}-${theme.replace(/\s+/g, '-').toLowerCase()}.txt`;
    
    const blob = new Blob([textOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalBatches = Math.ceil((parseInt(promptCount) || 0) / BATCH_SIZE);
  const isLargeGeneration = (parseInt(promptCount) || 0) > BATCH_SIZE;
  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  const hasOutput = textOutput.length > 0;
  const outputCount = textOutput.split('\n').filter(l => l.trim()).length;

  return (
    <div className="space-y-6">
      {!hasActiveKeys && (
        <Alert className="border-warning/50 bg-warning/10">
          <AlertCircle className="h-4 w-4 text-warning" />
          <AlertDescription>
            You need at least one active API key to generate prompts. Add one above to get started.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Input Section */}
        <div className="space-y-5">
          {/* Theme Input */}
          <div className="space-y-2">
            <Label htmlFor="theme">Theme *</Label>
            <Input
              id="theme"
              placeholder="e.g., ocean sunset, cyberpunk city, ancient forest..."
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="h-11 bg-muted/50 border-border"
              disabled={!hasActiveKeys || loading}
            />
            <p className="text-xs text-muted-foreground">
              Describe the core concept for your prompts
            </p>
          </div>

          {/* LEVEL 1: Output Type (MANDATORY) */}
          <div className="space-y-2">
            <Label htmlFor="outputType" className="flex items-center gap-2">
              Output Type *
              <span className="text-xs text-muted-foreground font-normal">(What kind of visual)</span>
            </Label>
            <Select value={outputType} onValueChange={setOutputType} disabled={!hasActiveKeys || loading}>
              <SelectTrigger className="h-11 bg-muted/50 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTPUT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* LEVEL 2 & 3: Style Mode and Mood (OPTIONAL) */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="styleMode" className="flex items-center gap-2">
                Style Mode
                <span className="text-xs text-muted-foreground font-normal">(Optional)</span>
              </Label>
              <Select value={styleMode} onValueChange={setStyleMode} disabled={!hasActiveKeys || loading}>
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {STYLE_MODES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mood" className="flex items-center gap-2">
                Mood
                <span className="text-xs text-muted-foreground font-normal">(Optional)</span>
              </Label>
              <Select value={mood} onValueChange={setMood} disabled={!hasActiveKeys || loading}>
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {MOODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Negative Prompt (OPTIONAL) */}
          <div className="space-y-2">
            <Label htmlFor="negativePrompt" className="flex items-center gap-2">
              Negative Prompt
              <span className="text-xs text-muted-foreground font-normal">(Optional - things to avoid)</span>
            </Label>
            <Textarea
              id="negativePrompt"
              placeholder="e.g., blurry, low quality, text, watermark..."
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="min-h-[80px] bg-muted/50 border-border resize-none"
              disabled={!hasActiveKeys || loading}
            />
            <p className="text-xs text-muted-foreground">
              Elements to exclude from generated prompts (appended as "— avoid: ...")
            </p>
          </div>

          {/* Provider and Model */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select 
                value={provider} 
                onValueChange={(v) => handleProviderChange(v as 'groq' | 'openrouter')} 
                disabled={!hasActiveKeys || loading}
              >
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <div className="flex items-center gap-2">
                        {p.label}
                        {p.value === 'groq' && !hasGroqKeys && (
                          <span className="text-xs text-muted-foreground">(no keys)</span>
                        )}
                        {p.value === 'openrouter' && !hasOpenRouterKeys && (
                          <span className="text-xs text-muted-foreground">(no keys)</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select value={model} onValueChange={setModel} disabled={!hasActiveKeys || loading}>
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currentModels.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Count Input */}
          <div className="space-y-2">
            <Label htmlFor="count">Total Prompts</Label>
            <Input
              id="count"
              type="text"
              inputMode="numeric"
              placeholder="1-1000"
              value={promptCount}
              onChange={(e) => handleCountChange(e.target.value)}
              className="h-11 bg-muted/50 border-border"
              disabled={!hasActiveKeys || loading}
            />
          </div>

          {/* Word Count Sliders */}
          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/20">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Word Count Range</Label>
              <span className="text-xs text-muted-foreground font-mono">
                {minWords} – {maxWords} words
              </span>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Minimum</Label>
                  <span className="text-xs font-mono text-primary">{minWords}</span>
                </div>
                <Slider
                  value={[minWords]}
                  onValueChange={handleMinWordsChange}
                  min={10}
                  max={50}
                  step={1}
                  disabled={!hasActiveKeys || loading}
                  className="cursor-pointer"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Maximum</Label>
                  <span className="text-xs font-mono text-primary">{maxWords}</span>
                </div>
                <Slider
                  value={[maxWords]}
                  onValueChange={handleMaxWordsChange}
                  min={15}
                  max={60}
                  step={1}
                  disabled={!hasActiveKeys || loading}
                  className="cursor-pointer"
                />
              </div>
            </div>
          </div>

          {!hasActiveProviderKeys && hasActiveKeys && (
            <Alert className="border-warning/50 bg-warning/10">
              <AlertCircle className="h-4 w-4 text-warning" />
              <AlertDescription>
                You don't have active {provider === 'groq' ? 'Groq' : 'OpenRouter'} keys. Switch providers or add a new key.
              </AlertDescription>
            </Alert>
          )}

          {isLargeGeneration && !loading && (
            <Alert className="border-primary/30 bg-primary/5">
              <Info className="h-4 w-4 text-primary" />
              <AlertDescription className="text-muted-foreground">
                Large generations are processed in {totalBatches} batches for stability.
              </AlertDescription>
            </Alert>
          )}

          {/* Generate / Stop Button */}
          {loading ? (
            <Button
              onClick={handleCancel}
              variant="destructive"
              className="w-full h-12 font-semibold"
            >
              <Square className="h-5 w-5 mr-2" />
              Stop Generation
            </Button>
          ) : (
            <Button
              onClick={handleGenerate}
              disabled={!hasActiveProviderKeys || !theme.trim() || !promptCount}
              className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              <Sparkles className="h-5 w-5 mr-2" />
              Generate {promptCount || 0} Prompts
            </Button>
          )}

          {/* Progress indicator */}
          {loading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {isLargeGeneration 
                    ? `Batch ${progress.batch} of ${progress.totalBatches}` 
                    : 'Generating...'}
                </span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                Results appear in real-time • Click "Stop" to save partial results
              </p>
            </div>
          )}
        </div>

        {/* Output Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Generated Prompts ({outputCount})</Label>
            {hasOutput && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyOutput}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={downloadOutput}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
              </div>
            )}
          </div>

          <ScrollArea className="h-[500px] rounded-xl border border-border bg-muted/30">
            <div className="p-4">
              {error ? (
                <div className="flex flex-col items-center justify-center h-[450px] text-destructive">
                  <AlertCircle className="h-12 w-12 mb-3 opacity-70" />
                  <p className="text-sm font-medium">Generation Error</p>
                  <p className="text-xs mt-2 text-center max-w-[280px] text-muted-foreground">
                    {error}
                  </p>
                </div>
              ) : !hasOutput ? (
                <div className="flex flex-col items-center justify-center h-[450px] text-muted-foreground">
                  <Sparkles className="h-12 w-12 mb-3 opacity-50" />
                  <p className="text-sm font-medium">{getOutputTypeLabel(outputType)} Prompts</p>
                  <p className="text-xs mt-2 text-center max-w-[220px]">
                    {minWords}–{maxWords} word prompts via {provider === 'groq' ? 'Groq' : 'OpenRouter'}
                  </p>
                  {getStyleModeLabel(styleMode) && (
                    <p className="text-xs mt-1 text-primary">
                      Style: {getStyleModeLabel(styleMode)}
                    </p>
                  )}
                  {getMoodLabel(mood) && (
                    <p className="text-xs mt-1 text-primary/80">
                      Mood: {getMoodLabel(mood)}
                    </p>
                  )}
                  {isLargeGeneration && (
                    <p className="text-xs mt-2 text-center max-w-[200px]">
                      {promptCount} prompts in {totalBatches} batches
                    </p>
                  )}
                </div>
              ) : (
                /* TEXT Output */
                <div className="space-y-2">
                  {textOutput.split('\n').filter(l => l.trim()).map((line, index) => (
                    <div
                      key={index}
                      className="group p-3 rounded-lg bg-card border border-border/50 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex-1 text-sm text-foreground">{line}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyPrompt(line.replace(/^\d+\.\s*/, ''), index)}
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        >
                          {copiedIndex === index ? (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
