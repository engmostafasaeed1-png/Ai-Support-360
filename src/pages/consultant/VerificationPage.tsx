import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  mockConsultantProfile, mockSkills, mockCertifications,
} from '@/data/consultantMockData';
import {
  ShieldCheck, Upload, CheckCircle, Clock, XCircle, AlertTriangle,
  FileText, Award, Brain,
} from 'lucide-react';

const verificationSteps = [
  { key: 'identity', label: 'Identity Verification', desc: 'Upload government-issued ID', status: 'completed' },
  { key: 'certifications', label: 'SAP Certifications', desc: 'Upload and verify SAP certificates', status: 'completed' },
  { key: 'experience', label: 'Experience Validation', desc: 'Verify work history and references', status: 'completed' },
  { key: 'skills', label: 'AI Skills Assessment', desc: 'Complete AI-powered skills evaluation', status: 'completed' },
  { key: 'interview', label: 'Technical Interview', desc: 'Pass a brief technical screening', status: 'completed' },
];

const statusIcon: Record<string, typeof CheckCircle> = {
  completed: CheckCircle,
  in_progress: Clock,
  pending: AlertTriangle,
  failed: XCircle,
};

const statusColor: Record<string, string> = {
  completed: 'text-green-500',
  in_progress: 'text-accent',
  pending: 'text-yellow-500',
  failed: 'text-red-500',
};

const verificationBadge: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700' },
  under_review: { label: 'Under Review', color: 'bg-blue-100 text-blue-700' },
  verified: { label: 'Verified', color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700' },
  suspended: { label: 'Suspended', color: 'bg-red-100 text-red-700' },
};

export default function VerificationPage() {
  const profile = mockConsultantProfile;
  const vBadge = verificationBadge[profile.verification_status];
  const completedSteps = verificationSteps.filter((s) => s.status === 'completed').length;
  const progress = Math.round((completedSteps / verificationSteps.length) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Verification Status</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your verification and credentials.</p>
      </div>

      {/* Verification Status Card */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center">
                <ShieldCheck className="w-7 h-7 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Verification Progress</h3>
                <p className="text-sm text-muted-foreground">{completedSteps} of {verificationSteps.length} steps completed</p>
              </div>
            </div>
            <Badge className={`${vBadge.color} text-sm px-4 py-1`}>{vBadge.label}</Badge>
          </div>
          <Progress value={progress} className="h-2 mb-6" />

          <div className="space-y-4">
            {verificationSteps.map((step, i) => {
              const Icon = statusIcon[step.status] || Clock;
              return (
                <div key={step.key} className="flex items-center gap-4 p-4 rounded-xl bg-muted/20 border border-border/30">
                  <div className="relative">
                    <Icon className={`w-5 h-5 ${statusColor[step.status]}`} />
                    {i < verificationSteps.length - 1 && (
                      <div className="absolute top-7 left-1/2 w-0.5 h-6 -translate-x-1/2 bg-border" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.desc}</p>
                  </div>
                  <span className={`text-xs font-medium capitalize ${statusColor[step.status]}`}>{step.status.replace('_', ' ')}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* AI Skills Score */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Brain className="w-4 h-4 text-accent" />
            AI Skills Evaluation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 mb-6">
            <div className="w-24 h-24 rounded-full border-4 border-accent flex items-center justify-center">
              <span className="text-2xl font-bold text-foreground">{profile.ai_skills_score}</span>
            </div>
            <div>
              <p className="font-medium text-foreground">Excellent Performance</p>
              <p className="text-sm text-muted-foreground">You scored in the top 5% of SAP consultants on the platform.</p>
            </div>
          </div>

          <div className="space-y-3">
            {mockSkills.map((skill) => (
              <div key={skill.module} className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground truncate">{skill.module}</span>
                    <div className="flex items-center gap-2">
                      {skill.certified && (
                        <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">Certified</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{skill.years} yrs</span>
                    </div>
                  </div>
                  <Progress value={skill.proficiency * 20} className="h-1.5" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Certifications */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Award className="w-4 h-4 text-accent" />
            Certifications
          </CardTitle>
          <Button variant="outline" size="sm" className="text-xs">
            <Upload className="w-3 h-3 me-1" /> Upload New
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {mockCertifications.map((cert, i) => (
            <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{cert.name}</p>
                  <p className="text-xs text-muted-foreground">{cert.issuer} · Issued {new Date(cert.issue_date).toLocaleDateString()}</p>
                </div>
              </div>
              {cert.verified ? (
                <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                  <CheckCircle className="w-3 h-3 me-1" /> Verified
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] bg-yellow-100 text-yellow-700">
                  <Clock className="w-3 h-3 me-1" /> Pending
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
