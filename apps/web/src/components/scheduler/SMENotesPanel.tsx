import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Send } from 'lucide-react';

interface SMENotesPanelProps {
  onProcessNotes: (notes: string) => void;
}

export function SMENotesPanel({ onProcessNotes }: SMENotesPanelProps) {
  const [notes, setNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcess = async () => {
    if (!notes.trim()) return;
    
    setIsProcessing(true);
    // Simulate AI processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    onProcessNotes(notes);
    setIsProcessing(false);
    setNotes('');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium">SME Notes</h3>
      </div>
      
      <Textarea
        placeholder="Paste situational notes here... e.g., 'India holiday on Friday' or 'Marcus unavailable Feb 16-20'"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="min-h-[100px] resize-none bg-muted/50 border-border text-sm placeholder:text-muted-foreground/50"
      />
      
      <Button
        onClick={handleProcess}
        disabled={!notes.trim() || isProcessing}
        className="w-full gap-2"
        variant="default"
      >
        {isProcessing ? (
          <>
            <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Process Notes
          </>
        )}
      </Button>
    </div>
  );
}
