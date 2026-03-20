import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImportedEmployee {
  name: string;
  legacyRole: string;
  mappedStatus: 'senior' | 'junior' | '';
}

interface ImportStats {
  employeesImported: number;
  historyMonths: number;
  coverageGaps: number;
}

interface ImportCenterProps {
  trigger?: React.ReactNode;
}

export function ImportCenter({ trigger }: ImportCenterProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'upload' | 'mapping' | 'success'>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [importedData, setImportedData] = useState<ImportedEmployee[]>([]);
  const [stats, setStats] = useState<ImportStats | null>(null);

  // Mock data for demonstration
  const mockImportedEmployees: ImportedEmployee[] = [
    { name: 'Sarah Chen', legacyRole: 'Security Analyst L3', mappedStatus: 'senior' },
    { name: 'Marcus Thompson', legacyRole: 'SOC Lead', mappedStatus: 'senior' },
    { name: 'Priya Sharma', legacyRole: 'Threat Hunter L2', mappedStatus: 'junior' },
    { name: 'Raj Patel', legacyRole: 'Security Engineer L1', mappedStatus: 'junior' },
    { name: 'Milan Jovanovic', legacyRole: 'Incident Responder L3', mappedStatus: 'senior' },
    { name: 'Ana Petrovic', legacyRole: 'Security Analyst L1', mappedStatus: 'junior' },
  ];

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Simulate file processing
    setTimeout(() => {
      setImportedData(mockImportedEmployees);
      setStep('mapping');
    }, 1000);
  }, []);

  const handleFileSelect = () => {
    // Simulate file selection
    setTimeout(() => {
      setImportedData(mockImportedEmployees);
      setStep('mapping');
    }, 1000);
  };

  const handleMappingChange = (index: number, status: 'senior' | 'junior') => {
    setImportedData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], mappedStatus: status };
      return updated;
    });
  };

  const handleComplete = () => {
    setStats({
      employeesImported: importedData.length,
      historyMonths: 12,
      coverageGaps: 4,
    });
    setStep('success');
  };

  const handleClose = () => {
    setOpen(false);
    setTimeout(() => {
      setStep('upload');
      setImportedData([]);
      setStats(null);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Upload className="w-4 h-4" />
            Import
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Import Center - Humanity Bridge
          </DialogTitle>
          <DialogDescription>
            Migrate your existing schedule data from Humanity or other CSV exports.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-12 text-center transition-colors",
              isDragging ? "border-primary bg-primary/5" : "border-border"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h4 className="text-lg font-semibold mb-2">Drop your Humanity CSV here</h4>
            <p className="text-sm text-muted-foreground mb-4">
              or click to browse files
            </p>
            <Button onClick={handleFileSelect}>
              Select File
            </Button>
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-primary/10 rounded-lg">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">
                {importedData.length} employees detected. Map their seniority status:
              </span>
            </div>
            
            <div className="max-h-[300px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Legacy Role</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importedData.map((employee, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{employee.name}</TableCell>
                      <TableCell className="text-muted-foreground">{employee.legacyRole}</TableCell>
                      <TableCell>
                        <Select
                          value={employee.mappedStatus}
                          onValueChange={(value) => handleMappingChange(index, value as 'senior' | 'junior')}
                        >
                          <SelectTrigger className="w-[120px] h-8">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="senior">Senior</SelectItem>
                            <SelectItem value="junior">Junior</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button onClick={handleComplete}>
                Complete Import
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'success' && stats && (
          <div className="space-y-6 py-4">
            <div className="flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-success" />
              </div>
            </div>
            
            <h3 className="text-xl font-bold text-center">Import Complete!</h3>
            
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Data Health Report
              </h4>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="space-y-1">
                  <div className="text-2xl font-bold text-primary">
                    {stats.employeesImported}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Employees Imported
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-2xl font-bold text-success">
                    {stats.historyMonths}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Month History Synced
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-2xl font-bold text-warning">
                    {stats.coverageGaps}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Coverage Gaps Found
                  </div>
                </div>
              </div>
            </div>

            {stats.coverageGaps > 0 && (
              <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-warning mt-0.5" />
                <div className="text-sm">
                  <span className="font-medium">Coverage gaps detected.</span>
                  <span className="text-muted-foreground ml-1">
                    Click "AI Redistribute" to automatically fill these gaps.
                  </span>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleClose} className="w-full">
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
