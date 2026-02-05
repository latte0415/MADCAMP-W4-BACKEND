import { Music, User, LogOut, ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';

interface HeaderProps {
  onBack?: () => void;
  showBack?: boolean;
  showLogo?: boolean;
  variant?: 'default' | 'studio';
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function Header({
  onBack,
  showBack = false,
  showLogo = true,
  variant = 'default',
  userName = '게스트',
  onLogin,
  onLogout,
}: HeaderProps) {
  const isStudio = variant === 'studio';
  const headerClass = isStudio
    ? 'h-12 border-b border-white/5 bg-black/20 backdrop-blur-sm'
    : 'h-14 border-b border-white/10 bg-zinc-900/80 backdrop-blur-xl';
  const backButtonClass = isStudio
    ? 'gap-2 text-neutral-400 hover:text-white'
    : 'gap-2 text-zinc-400 hover:text-white';
  const logoWrapClass = isStudio
    ? 'text-xs text-neutral-200 tracking-wide'
    : 'font-semibold text-white';
  const userWrapClass = isStudio
    ? 'text-xs text-neutral-500'
    : 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10';
  const userTextClass = isStudio ? 'text-neutral-500' : 'text-sm text-zinc-300';
  const authButtonClass = isStudio
    ? 'text-neutral-400 hover:text-white text-xs'
    : 'gap-2 text-zinc-400 hover:text-white';

  return (
    <header className={`${headerClass} flex items-center justify-between px-6`}>
      <div className="flex items-center gap-4">
        {showBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className={backButtonClass}
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
        )}
        {showLogo && (
          <div className="flex items-center gap-2">
            {isStudio ? (
              <>
                <span className={logoWrapClass}>D+M LAB</span>
                <span className="text-[10px] text-neutral-500">project</span>
              </>
            ) : (
              <>
                <div className="size-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <Music className="size-4 text-white" />
                </div>
                <span className={logoWrapClass}>Dance + Magic Analysis Lab</span>
              </>
            )}
          </div>
        )}
      </div>
      
      <div className="flex items-center gap-3">
        <div className={userWrapClass}>
          {!isStudio && <User className="size-4 text-zinc-400" />}
          <span className={userTextClass}>{userName}</span>
        </div>
        {onLogin && userName === '게스트' ? (
          <Button
            variant="ghost"
            size="sm"
            className={authButtonClass}
            onClick={onLogin}
          >
            {!isStudio && <LogOut className="size-4" />}
            Login
          </Button>
        ) : onLogout ? (
          <Button
            variant="ghost"
            size="sm"
            className={authButtonClass}
            onClick={onLogout}
          >
            {!isStudio && <LogOut className="size-4" />}
            Logout
          </Button>
        ) : null}
      </div>
    </header>
  );
}
