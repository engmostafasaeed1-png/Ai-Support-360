import jsPDF from 'jspdf';

interface InterviewAnswer {
  question: string;
  category: string;
  score: number | null;
  answer_transcript: string | null;
  ai_feedback: string | null;
  question_order: number;
}

interface InterviewSession {
  interview_type?: string;
  overall_score?: number | null;
  technical_score?: number | null;
  soft_skills_score?: number | null;
  ai_summary?: string | null;
  created_at?: string;
  completed_at?: string | null;
}

export function generateInterviewPdf(
  answers: InterviewAnswer[],
  session?: InterviewSession | null,
  consultantName?: string,
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const margin = 18;
  const maxW = pw - margin * 2;
  let y = margin;

  const addPage = () => { doc.addPage(); y = margin; };
  const ensureSpace = (need: number) => { if (y + need > 280) addPage(); };

  // Header
  doc.setFillColor(27, 37, 89); // primary
  doc.rect(0, 0, pw, 36, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Interview Results Report', margin, 16);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (consultantName) doc.text(consultantName, margin, 24);
  const dateStr = session?.created_at
    ? new Date(session.created_at).toLocaleDateString()
    : new Date().toLocaleDateString();
  doc.text(dateStr, pw - margin, 24, { align: 'right' });
  if (session?.interview_type) {
    doc.text(`Type: ${session.interview_type.toUpperCase()}`, pw - margin, 16, { align: 'right' });
  }
  y = 44;

  // Score overview
  doc.setTextColor(27, 37, 89);
  if (session?.overall_score != null) {
    ensureSpace(30);
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(margin, y, maxW, 24, 3, 3, 'F');

    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text(`${session.overall_score}`, margin + maxW / 2, y + 12, { align: 'center' });
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 140);
    doc.text('OVERALL SCORE / 100', margin + maxW / 2, y + 19, { align: 'center' });

    if (session.technical_score != null) {
      doc.setFontSize(14);
      doc.setTextColor(27, 37, 89);
      doc.setFont('helvetica', 'bold');
      doc.text(`${session.technical_score}`, margin + 20, y + 12);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120, 120, 140);
      doc.text('Technical', margin + 20, y + 18, { align: 'center' });
    }
    if (session.soft_skills_score != null) {
      doc.setFontSize(14);
      doc.setTextColor(27, 37, 89);
      doc.setFont('helvetica', 'bold');
      doc.text(`${session.soft_skills_score}`, pw - margin - 20, y + 12, { align: 'center' });
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120, 120, 140);
      doc.text('Soft Skills', pw - margin - 20, y + 18, { align: 'center' });
    }
    y += 30;
  }

  // AI Summary
  if (session?.ai_summary) {
    ensureSpace(20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(27, 37, 89);
    doc.text('AI SUMMARY', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 80);
    const summaryLines = doc.splitTextToSize(session.ai_summary, maxW);
    ensureSpace(summaryLines.length * 4 + 4);
    doc.setFontSize(9);
    doc.text(summaryLines, margin, y);
    y += summaryLines.length * 4 + 6;
  }

  // Divider
  doc.setDrawColor(220, 220, 230);
  doc.line(margin, y, pw - margin, y);
  y += 6;

  // Questions
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(27, 37, 89);
  doc.text('Questions & Answers', margin, y);
  y += 8;

  answers.forEach((a, idx) => {
    ensureSpace(40);

    // Question header
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(margin, y, maxW, 7, 2, 2, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(27, 37, 89);
    doc.text(`Q${idx + 1}`, margin + 3, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 120);
    doc.text(a.category.toUpperCase(), margin + 14, y + 5);

    if (a.score != null) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(27, 37, 89);
      doc.setFontSize(9);
      doc.text(`${a.score}/10`, pw - margin - 3, y + 5, { align: 'right' });
    }
    y += 10;

    // Question text
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 60);
    const qLines = doc.splitTextToSize(a.question, maxW - 4);
    ensureSpace(qLines.length * 4 + 4);
    doc.text(qLines, margin + 2, y);
    y += qLines.length * 4 + 3;

    // Answer
    if (a.answer_transcript) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(60, 60, 80);
      const aLines = doc.splitTextToSize(a.answer_transcript, maxW - 4);
      ensureSpace(aLines.length * 3.5 + 4);
      doc.text(aLines, margin + 2, y);
      y += aLines.length * 3.5 + 3;
    }

    // AI Feedback
    if (a.ai_feedback) {
      ensureSpace(16);
      doc.setFillColor(235, 240, 255);
      const fbLines = doc.splitTextToSize(a.ai_feedback, maxW - 10);
      const fbH = fbLines.length * 3.5 + 6;
      ensureSpace(fbH + 2);
      doc.roundedRect(margin + 2, y, maxW - 4, fbH, 2, 2, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(59, 130, 246);
      doc.text('AI Feedback:', margin + 5, y + 4);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 50, 80);
      doc.text(fbLines, margin + 5, y + 8);
      y += fbH + 4;
    }

    y += 4;
  });

  // Footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(160, 160, 180);
    doc.text('AI Support Now — Interview Results', margin, 290);
    doc.text(`Page ${i} of ${totalPages}`, pw - margin, 290, { align: 'right' });
  }

  const fileName = `interview-results-${dateStr.replace(/\//g, '-')}.pdf`;
  doc.save(fileName);
}
