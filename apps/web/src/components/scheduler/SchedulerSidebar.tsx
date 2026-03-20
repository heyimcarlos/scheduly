import { useState } from 'react';
import { TeamMember, AISuggestion } from '@/types/scheduler';
import { TeamMemberCard } from './TeamMemberCard';
import { AISuggestionCard } from './AISuggestionCard';
import { SMENotesPanel } from './SMENotesPanel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Brain, Users, Lightbulb, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SchedulerSidebarProps {
  teamMembers: TeamMember[];
  suggestions: AISuggestion[];
  onAcceptSuggestion: (id: string) => void;
  onRejectSuggestion: (id: string) => void;
  onProcessNotes: (notes: string) => void;
}

export function SchedulerSidebar({
  teamMembers,
  suggestions,
  onAcceptSuggestion,
  onRejectSuggestion,
  onProcessNotes,
}: SchedulerSidebarProps) {
  const [expandedSections, setExpandedSections] = useState({
    notes: true,
    suggestions: true,
    team: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const sortedMembers = [...teamMembers].sort((a, b) => b.fatigueScore - a.fatigueScore);

  return (
    <div className="w-80 h-full bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Managerial Intelligence</h2>
            <p className="text-xs text-muted-foreground">AI-Powered Insights</p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* SME Notes Section */}
          <div>
            <button
              onClick={() => toggleSection('notes')}
              className="flex items-center justify-between w-full text-left mb-2"
            >
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Input Notes
              </span>
              {expandedSections.notes ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {expandedSections.notes && (
              <SMENotesPanel onProcessNotes={onProcessNotes} />
            )}
          </div>

          <Separator className="bg-sidebar-border" />

          {/* AI Suggestions Section */}
          <div>
            <button
              onClick={() => toggleSection('suggestions')}
              className="flex items-center justify-between w-full text-left mb-2"
            >
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-warning" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  AI Suggestions
                </span>
                {suggestions.length > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-warning/20 text-warning">
                    {suggestions.length}
                  </span>
                )}
              </div>
              {expandedSections.suggestions ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {expandedSections.suggestions && (
              <div className="space-y-2">
                {suggestions.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No pending suggestions
                  </p>
                ) : (
                  suggestions.map(suggestion => (
                    <AISuggestionCard
                      key={suggestion.id}
                      suggestion={suggestion}
                      onAccept={onAcceptSuggestion}
                      onReject={onRejectSuggestion}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          <Separator className="bg-sidebar-border" />

          {/* Team Members Section */}
          <div>
            <button
              onClick={() => toggleSection('team')}
              className="flex items-center justify-between w-full text-left mb-2"
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Team Fatigue Monitor
                </span>
              </div>
              {expandedSections.team ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {expandedSections.team && (
              <div className="space-y-2">
                {sortedMembers.map(member => (
                  <TeamMemberCard key={member.id} member={member} />
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
