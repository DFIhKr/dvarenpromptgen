import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { ArrowRight, Shield, Zap, Key, Sparkles } from 'lucide-react';

export default function Index() {
  const { user } = useAuth();

  const features = [
    {
      icon: Key,
      title: 'Your Own API Keys',
      description: 'Use your personal Groq API keys. We never share or access other users\' keys.',
    },
    {
      icon: Shield,
      title: 'Secure & Encrypted',
      description: 'API keys are encrypted and stored securely. Never exposed to the frontend.',
    },
    {
      icon: Zap,
      title: 'Smart Key Rotation',
      description: 'Automatic key rotation to avoid rate limits and maximize uptime.',
    },
    {
      icon: Sparkles,
      title: 'Powerful Models',
      description: 'Access Llama 4 Scout, Maverick, and other cutting-edge models from Groq.',
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm fixed top-0 w-full z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-4">
            {user ? (
              <Link to="/dashboard">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                    Sign In
                  </Button>
                </Link>
                <Link to="/register">
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                    Get Started
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'var(--gradient-glow)' }} />
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-8">
              <Sparkles className="h-4 w-4" />
              Powered by Groq's Ultra-Fast LLMs
            </div>
            
            <h1 className="text-5xl md:text-6xl font-bold text-foreground mb-6 leading-tight">
              Generate powerful prompts with{' '}
              <span className="text-gradient">your own API keys</span>
            </h1>
            
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              A secure, private prompt generator where you bring your own Groq API keys. 
              Your data stays yours—we never see or store your prompts.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/register">
                <Button 
                  size="lg" 
                  className="h-14 px-8 text-lg bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
                >
                  Start Generating
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <a 
                href="https://console.groq.com/keys" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <Button 
                  variant="outline" 
                  size="lg"
                  className="h-14 px-8 text-lg border-border hover:bg-muted"
                >
                  Get Groq API Key
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 border-t border-border/50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              Built for privacy & performance
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Each user manages their own API keys. Complete isolation ensures your data never touches other users.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {features.map((feature, index) => (
              <div
                key={index}
                className="p-6 rounded-xl border border-border bg-card hover:border-primary/30 transition-colors group"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/20 text-primary flex items-center justify-center mb-4 group-hover:bg-primary/30 transition-colors">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 border-t border-border/50">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              Ready to generate prompts?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Sign up for free and start using your Groq API keys in seconds.
            </p>
            <Link to="/register">
              <Button 
                size="lg" 
                className="h-14 px-8 text-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Create Free Account
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border/50">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <Logo size="sm" />
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} PromptGen. Your API keys, your control.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
