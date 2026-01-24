import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Sparkles, Copy, Download, Check, AlertCircle, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PromptGeneratorProps {
  hasActiveKeys: boolean;
}

interface GeneratedPrompt {
  id: number;
  text: string;
}

interface JsonOutput {
  theme: string;
  output_type: string;
  style_mode: string | null;
  mood: string | null;
  length_rule: {
    min_words: number;
    max_words: number;
  };
  prompts: GeneratedPrompt[];
}

const MODELS = [
  { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout (17B)' },
  { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick (17B)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 (70B)' },
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 (8B)' },
];

// LEVEL 1: Output Type (MANDATORY) - Defines WHAT kind of visual
const OUTPUT_TYPES = [
  { value: 'photo', label: 'Photo' },
  { value: 'illustration', label: 'Illustration' },
  { value: 'vector', label: 'Vector' },
  { value: 'typography', label: 'Typography' },
  { value: 'ui_screen', label: 'UI / Screen' },
  { value: 'video_prompt', label: 'Video Prompt' },
];

// LEVEL 2: Style Mode (OPTIONAL) - Defines HOW the output looks
const STYLE_MODES = [
  { value: '', label: 'None (Default)' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'glitch', label: 'Glitch' },
  { value: 'retro', label: 'Retro' },
  { value: 'cyberpunk', label: 'Cyberpunk' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'clean', label: 'Clean' },
  { value: 'neon', label: 'Neon' },
  { value: 'vintage', label: 'Vintage' },
];

// LEVEL 3: Mood / Tone (OPTIONAL) - Defines emotional feeling
const MOODS = [
  { value: '', label: 'None (Default)' },
  { value: 'dark', label: 'Dark' },
  { value: 'calm', label: 'Calm' },
  { value: 'futuristic', label: 'Futuristic' },
  { value: 'horror', label: 'Horror' },
  { value: 'energetic', label: 'Energetic' },
  { value: 'dreamy', label: 'Dreamy' },
  { value: 'mysterious', label: 'Mysterious' },
  { value: 'uplifting', label: 'Uplifting' },
];

const OUTPUT_FORMATS = [
  { value: 'text', label: 'TEXT' },
  { value: 'json', label: 'JSON' },
];

const BATCH_SIZE = 20;

export function PromptGenerator({ hasActiveKeys }: PromptGeneratorProps) {
  const [theme, setTheme] = useState('');
  const [model, setModel] = useState(MODELS[0].value);
  const [outputType, setOutputType] = useState(OUTPUT_TYPES[0].value);
  const [styleMode, setStyleMode] = useState('');
  const [mood, setMood] = useState('');
  const [outputFormat, setOutputFormat] = useState<'json' | 'text'>('text');
  const [promptCount, setPromptCount] = useState('20');
  const [minWords, setMinWords] = useState(22);
  const [maxWords, setMaxWords] = useState(35);
  const [output, setOutput] = useState<JsonOutput | null>(null);
  const [textOutput, setTextOutput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

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
    if (!value) return null;
    return STYLE_MODES.find(s => s.value === value)?.label || value;
  };

  const getMoodLabel = (value: string) => {
    if (!value) return null;
    return MOODS.find(m => m.value === value)?.label || value;
  };

  const handleGenerate = async () => {
    if (!theme.trim()) {
      toast({
        variant: 'destructive',
        title: 'Theme required',
        description: 'Please enter a theme for your prompts.',
      });
      return;
    }

    const count = parseInt(promptCount) || 20;
    if (count < 1 || count > 1000) {
      toast({
        variant: 'destructive',
        title: 'Invalid count',
        description: 'Please enter a number between 1 and 1000.',
      });
      return;
    }

    setLoading(true);
    setOutput(null);
    setTextOutput('');
    setError(null);
    setProgress({ current: 0, total: count });

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('generate-prompts', {
        body: {
          theme: theme.trim(),
          model,
          outputType,
          styleMode: styleMode || null,
          mood: mood || null,
          outputFormat,
          count,
          minWords,
          maxWords,
        },
      });

      if (invokeError) throw invokeError;

      if (data.error) {
        throw new Error(data.error);
      }

      // CRITICAL: Check if we have prompts
      const prompts = data.prompts || [];
      
      if (prompts.length === 0) {
        throw new Error('No prompts were generated. The model output could not be parsed correctly. Please try again.');
      }

      if (outputFormat === 'text') {
        // TEXT format: numbered list
        const textList = prompts
          .map((text: string, index: number) => `${index + 1}. ${text}`)
          .join('\n');
        setTextOutput(textList);
        setProgress({ current: prompts.length, total: count });
      } else {
        // JSON format
        const jsonOutput: JsonOutput = {
          theme: theme.trim(),
          output_type: getOutputTypeLabel(outputType),
          style_mode: getStyleModeLabel(styleMode),
          mood: getMoodLabel(mood),
          length_rule: {
            min_words: minWords,
            max_words: maxWords,
          },
          prompts: prompts.map((text: string, index: number) => ({
            id: index + 1,
            text,
          })),
        };

        setOutput(jsonOutput);
        setProgress({ current: jsonOutput.prompts.length, total: count });
      }

      if (data.partial) {
        toast({
          variant: 'default',
          title: 'Partial results',
          description: data.message || `Generated ${prompts.length} of ${count} prompts.`,
        });
      } else {
        toast({
          title: 'Generation complete',
          description: `Successfully generated ${prompts.length} prompts.`,
        });
      }
    } catch (err) {
      console.error('Generation error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate prompts';
      setError(errorMessage);
      toast({
        variant: 'destructive',
        title: 'Generation failed',
        description: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const copyPrompt = async (prompt: string, index: number) => {
    await navigator.clipboard.writeText(prompt);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyOutput = async () => {
    if (outputFormat === 'text') {
      if (!textOutput) return;
      await navigator.clipboard.writeText(textOutput);
      toast({
        title: 'Copied!',
        description: 'Text output copied to clipboard.',
      });
    } else {
      if (!output) return;
      await navigator.clipboard.writeText(JSON.stringify(output, null, 2));
      toast({
        title: 'Copied!',
        description: 'JSON output copied to clipboard.',
      });
    }
  };

  const downloadOutput = () => {
    const typeSuffix = outputType.replace(/_/g, '-');
    const filename = `prompts-${typeSuffix}-${theme.replace(/\s+/g, '-').toLowerCase()}`;
    
    if (outputFormat === 'text') {
      if (!textOutput) return;
      const blob = new Blob([textOutput], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      if (!output) return;
      const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const totalBatches = Math.ceil((parseInt(promptCount) || 0) / BATCH_SIZE);
  const isLargeGeneration = (parseInt(promptCount) || 0) > BATCH_SIZE;
  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  const hasOutput = outputFormat === 'text' ? textOutput.length > 0 : (output?.prompts.length || 0) > 0;
  const outputCount = outputFormat === 'text' ? textOutput.split('\n').filter(l => l.trim()).length : (output?.prompts.length || 0);

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
                    <SelectItem key={s.value || 'none'} value={s.value}>
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
                    <SelectItem key={m.value || 'none'} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Model and Output Format */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select value={model} onValueChange={setModel} disabled={!hasActiveKeys || loading}>
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="outputFormat">Output Format</Label>
              <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as 'json' | 'text')} disabled={!hasActiveKeys || loading}>
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
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

          {isLargeGeneration && (
            <Alert className="border-primary/30 bg-primary/5">
              <Info className="h-4 w-4 text-primary" />
              <AlertDescription className="text-muted-foreground">
                Large generations are processed in {totalBatches} batches to ensure quality and stability.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleGenerate}
            disabled={!hasActiveKeys || loading || !theme.trim() || !promptCount}
            className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5 mr-2" />
                Generate {promptCount || 0} Prompts
              </>
            )}
          </Button>

          {loading && isLargeGeneration && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Processing batches...</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
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
                  Copy {outputFormat.toUpperCase()}
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
                    {outputFormat.toUpperCase()} output with {minWords}–{maxWords} word prompts
                  </p>
                  {styleMode && (
                    <p className="text-xs mt-1 text-primary">
                      Style: {getStyleModeLabel(styleMode)}
                    </p>
                  )}
                  {mood && (
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
              ) : outputFormat === 'text' ? (
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
              ) : (
                /* JSON Output */
                <div className="space-y-4">
                  {/* JSON Header Info */}
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Theme:</span>{' '}
                        <span className="text-foreground font-medium">{output?.theme}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Type:</span>{' '}
                        <span className="text-foreground font-medium">{output?.output_type}</span>
                      </div>
                      {output?.style_mode && (
                        <div>
                          <span className="text-muted-foreground">Style:</span>{' '}
                          <span className="text-foreground font-medium">{output.style_mode}</span>
                        </div>
                      )}
                      {output?.mood && (
                        <div>
                          <span className="text-muted-foreground">Mood:</span>{' '}
                          <span className="text-foreground font-medium">{output.mood}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Words:</span>{' '}
                        <span className="text-foreground font-medium">
                          {output?.length_rule.min_words}–{output?.length_rule.max_words}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Prompt Cards */}
                  <div className="space-y-2">
                    {output?.prompts.map((prompt, index) => (
                      <div
                        key={prompt.id}
                        className="group p-3 rounded-lg bg-card border border-border/50 hover:border-primary/30 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                            {prompt.id}
                          </span>
                          <p className="flex-1 text-sm text-foreground">{prompt.text}</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyPrompt(prompt.text, index)}
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
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
