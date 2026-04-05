import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, X, ChevronDown, ChevronUp, Award, Globe, DollarSign, Brain } from 'lucide-react';
import { pendingConsultants } from '@/data/adminMockData';

export default function ConsultantApprovalsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('approvals_page.title')}</h1>
        <p className="text-sm text-muted-foreground">{pendingConsultants.length} {t('approvals_page.subtitle')}</p>
      </div>

      <div className="space-y-4">
        {pendingConsultants.map((c) => {
          const isExpanded = expanded === c.id;
          return (
            <Card key={c.id} className="border-border/50">
              <CardContent className="p-0">
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : c.id)}
                >
                  <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
                    {c.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.modules.join(' · ')} · {c.experience} yrs</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-center hidden sm:block">
                      <div className="flex items-center gap-1">
                        <Brain className="w-3.5 h-3.5 text-accent" />
                        <span className="text-sm font-bold text-foreground">{c.aiScore}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{t('approvals_page.ai_score')}</p>
                    </div>
                    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 text-[10px]">
                      {t('approvals_page.pending')}
                    </Badge>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border/50 p-4 bg-muted/10">
                    <div className="grid sm:grid-cols-2 gap-4 mb-4">
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">{t('approvals_page.bio')}</h4>
                        <p className="text-sm text-foreground">{c.bio}</p>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">{t('approvals_page.certifications')}</h4>
                          <div className="space-y-1">
                            {c.certifications.map((cert) => (
                              <div key={cert} className="flex items-center gap-1.5 text-sm text-foreground">
                                <Award className="w-3.5 h-3.5 text-accent shrink-0" />
                                {cert}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="flex items-center gap-1.5 text-sm">
                            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                            {c.languages.join(', ')}
                          </div>
                          <div className="flex items-center gap-1.5 text-sm">
                            <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                            ${c.hourlyRate}{t('common.per_hour')}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-xs text-muted-foreground">SAP Modules:</span>
                      {c.modules.map((m) => (
                        <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                      ))}
                    </div>

                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-muted-foreground">{t('approvals_page.ai_skills_assessment')}</span>
                        <span className="text-xs font-bold text-foreground">{c.aiScore}/100</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full gradient-primary transition-all"
                          style={{ width: `${c.aiScore}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 justify-end">
                      <span className="text-xs text-muted-foreground me-auto">{t('approvals_page.applied')}: {c.appliedAt}</span>
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10">
                        <X className="w-3.5 h-3.5 me-1" /> {t('approvals_page.reject')}
                      </Button>
                      <Button size="sm" className="gradient-primary border-0">
                        <Check className="w-3.5 h-3.5 me-1" /> {t('approvals_page.approve')}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
