import logo from '@/assets/logo.png';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

const textSizeClasses = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-2xl',
};

export function Logo({ size = 'md', showText = true }: LogoProps) {
  return (
    <div className="flex items-center gap-3">
      <img 
        src={logo} 
        alt="PromptGen Logo" 
        className={`${sizeClasses[size]} object-contain`}
      />
      {showText && (
        <span className={`${textSizeClasses[size]} font-bold text-foreground`}>
          Prompt<span className="text-primary">Gen</span>
        </span>
      )}
    </div>
  );
}
