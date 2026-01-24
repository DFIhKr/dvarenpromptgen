import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { ApiKeyCard } from '@/components/dashboard/ApiKeyCard';
import { AddApiKeyDialog } from '@/components/dashboard/AddApiKeyDialog';
import { PromptGenerator } from '@/components/dashboard/PromptGenerator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LogOut, Key, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ApiKey {
  id: string;
  key_hint: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchApiKeys = async () => {
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, key_hint, label, is_active, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setApiKeys(data || []);
    } catch (error) {
      console.error('Error fetching API keys:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load API keys.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const handleAddKey = async (apiKey: string, label?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('manage-api-keys', {
        body: { action: 'add', apiKey, label },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast({
        title: 'API key added',
        description: 'Your API key has been securely stored.',
      });
      fetchApiKeys();
    } catch (error) {
      console.error('Error adding API key:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add API key.',
      });
      throw error;
    }
  };

  const handleToggleKey = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('api_keys')
        .update({ is_active: isActive })
        .eq('id', id);

      if (error) throw error;

      setApiKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, is_active: isActive } : k))
      );

      toast({
        title: isActive ? 'Key enabled' : 'Key disabled',
        description: `API key has been ${isActive ? 'enabled' : 'disabled'}.`,
      });
    } catch (error) {
      console.error('Error toggling API key:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update API key.',
      });
    }
  };

  const handleDeleteKey = async (id: string) => {
    try {
      const { error } = await supabase.from('api_keys').delete().eq('id', id);

      if (error) throw error;

      setApiKeys((prev) => prev.filter((k) => k.id !== id));

      toast({
        title: 'Key deleted',
        description: 'API key has been permanently removed.',
      });
    } catch (error) {
      console.error('Error deleting API key:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete API key.',
      });
    }
  };

  const activeKeysCount = apiKeys.filter((k) => k.is_active).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {user?.email}
            </span>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* API Keys Section */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/20 text-primary">
                <Key className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">API Keys</h2>
                <p className="text-sm text-muted-foreground">
                  {apiKeys.length}/5 keys · {activeKeysCount} active
                </p>
              </div>
            </div>
            <AddApiKeyDialog
              onAdd={handleAddKey}
              disabled={loading}
              keyCount={apiKeys.length}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-dashed border-border bg-muted/20">
              <Key className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No API keys yet
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Add your first Groq API key to start generating prompts
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {apiKeys.map((key) => (
                <ApiKeyCard
                  key={key.id}
                  id={key.id}
                  keyHint={key.key_hint}
                  label={key.label}
                  isActive={key.is_active}
                  createdAt={key.created_at}
                  onToggle={handleToggleKey}
                  onDelete={handleDeleteKey}
                />
              ))}
            </div>
          )}
        </section>

        {/* Prompt Generator Section */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/20 text-primary">
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Prompt Generator
              </h2>
              <p className="text-sm text-muted-foreground">
                Generate creative prompts using Groq's LLM models
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <PromptGenerator hasActiveKeys={activeKeysCount > 0} />
          </div>
        </section>
      </main>
    </div>
  );
}
