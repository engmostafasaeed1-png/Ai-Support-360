export interface NDARecord {
  id: string;
  consultant_name: string;
  client_name: string;
  signature_type: string;
  signature_data: string;
  signed_at: string;
  nda_content: string;
  revoked_at: string | null;
}
