import { useRef, useEffect, useState } from 'react';
import { Project } from '../../types';
import { HeroSection } from './HeroSection';
import { DJStudio, NewProjectData } from './DJStudio';

interface LandingPageProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
  onEnterProject?: (
    project: Project,
    onProgress?: (value: number, label?: string) => void
  ) => Promise<void> | void;
  onNewProject?: () => void;
  onCreateProject?: (data: NewProjectData) => void;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function LandingPage({
  projects,
  onSelectProject,
  onEnterProject,
  onNewProject,
  onCreateProject,
  userName,
  onLogin,
  onLogout,
}: LandingPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const [currentSection, setCurrentSection] = useState<'hero' | 'studio'>('hero');

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            if (entry.target === heroRef.current) {
              setCurrentSection('hero');
            } else if (entry.target === studioRef.current) {
              setCurrentSection('studio');
            }
          }
        });
      },
      {
        root: containerRef.current,
        threshold: 0.5,
      }
    );

    if (heroRef.current) observer.observe(heroRef.current);
    if (studioRef.current) observer.observe(studioRef.current);

    return () => observer.disconnect();
  }, []);

  const scrollToSection = (section: 'hero' | 'studio') => {
    const target = section === 'hero' ? heroRef.current : studioRef.current;
    target?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div
      ref={containerRef}
      className="h-screen overflow-y-auto snap-y snap-mandatory"
      style={{
        scrollSnapType: 'y mandatory',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      {/* Hide scrollbar for webkit */}
      <style>{`
        div::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {/* Hero Section */}
      <div ref={heroRef} className="snap-start snap-always h-screen">
        <HeroSection onScrollDown={() => scrollToSection('studio')} />
      </div>

      {/* DJ Studio Section */}
      <div ref={studioRef} className="snap-start snap-always h-screen">
        <DJStudio
          projects={projects}
          onOpenProject={onSelectProject}
          onEnterProject={onEnterProject}
          onNewProject={onNewProject}
          onCreateProject={onCreateProject}
          userName={userName}
          onLogin={onLogin}
          onLogout={onLogout}
        />
      </div>

      {/* Section indicators */}
      <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3">
        <button
          onClick={() => scrollToSection('hero')}
          className="group relative"
          aria-label="Go to intro"
        >
          <div
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              currentSection === 'hero'
                ? 'bg-amber-500 scale-150 shadow-lg shadow-amber-500/50'
                : 'bg-amber-200/30 hover:bg-amber-200/50'
            }`}
          />
          <span className="absolute right-6 top-1/2 -translate-y-1/2 px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-amber-900/80 text-amber-100">
            Intro
          </span>
        </button>
        <button
          onClick={() => scrollToSection('studio')}
          className="group relative"
          aria-label="Go to studio"
        >
          <div
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              currentSection === 'studio'
                ? 'bg-amber-500 scale-150 shadow-lg shadow-amber-500/50'
                : 'bg-amber-200/30 hover:bg-amber-200/50'
            }`}
          />
          <span className="absolute right-6 top-1/2 -translate-y-1/2 px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-amber-900/80 text-amber-100">
            Studio
          </span>
        </button>
      </div>
    </div>
  );
}
