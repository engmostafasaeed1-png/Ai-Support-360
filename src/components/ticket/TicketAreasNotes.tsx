import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SapNoteLinks } from '@/components/ticket/SapNotesField';
import { areaLabel } from '@/lib/sapAreas';

interface Props {
  /** Every area of the ticket, the main one first. */
  areas: string[];
  /** The name the client gave for the area "Other". */
  other?: string | null;
  /** What the client wrote about the areas. */
  details?: string | null;
  /** The SAP Note numbers the client already tried. */
  notes: string[];
}

/** For the expert who works on a ticket: all the areas the client chose, the client's own words about them and the SAP Notes already tried. It shows nothing when there is nothing beyond one area. */
export default function TicketAreasNotes({ areas, other, details, notes }: Props) {
  const otherName = (other ?? '').trim();
  const detailText = (details ?? '').trim();
  const showAreas = areas.length > 1 || otherName !== '' || detailText !== '';
  if (!showAreas && notes.length === 0) return null;
  return (
    <>
      {showAreas && (
        <Card className="rounded-2xl border-border/50" data-testid="ticket-areas">
          <CardContent className="space-y-3 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SAP areas</p>
            <div className="flex flex-wrap gap-1.5">
              {areas.map((name, i) => (
                <Badge key={name} variant="secondary" className="gap-1 text-xs">
                  {i === 0 && areas.length > 1 && <Star className="h-3 w-3 fill-accent text-accent" aria-label="Main area" />}
                  {areaLabel(name, otherName)}
                </Badge>
              ))}
            </div>
            {detailText && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">More details about the areas</p>
                <p className="whitespace-pre-wrap text-sm text-foreground">{detailText}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {notes.length > 0 && (
        <Card className="rounded-2xl border-border/50" data-testid="notes-tried">
          <CardContent className="space-y-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SAP Notes the client already tried</p>
            <SapNoteLinks notes={notes} />
            <p className="text-[11px] text-muted-foreground">Each note opens in SAP for Me. You need your own SAP login to read it.</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
