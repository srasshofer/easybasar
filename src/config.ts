// Entspricht den Konstanten aus der easybasar-App.
// EASYBASAR_API_URL nur für Tests (z. B. Mock-Server).
export const apiURL = process.env.EASYBASAR_API_URL ?? "https://www.easybasar.de";
export const apiVersion = "v0.8";
export const apiInstance = "a";
export const clientVersion = "1.0.0";
export const language = "de";

export const apiUrlIncludes = `${apiURL}/app/${apiVersion}/${apiInstance}/includes`;
export const phpUrlIncludes = `${apiURL}/app/${apiVersion}/${apiInstance}/includes/api/php`;
export const pdfUrlIncludes = `${apiURL}/app/${apiVersion}/${apiInstance}/includes/Pdf`;
export const apiUrlUserfiles = `${apiURL}/userfiles`;
export const apiUrlPdfs = `${apiURL}/pdfs`;

export const BASES = {
  includes: apiUrlIncludes,
  php: phpUrlIncludes,
  pdf: pdfUrlIncludes,
  userfiles: apiUrlUserfiles,
  pdfs: apiUrlPdfs,
} as const;

export type BaseName = keyof typeof BASES;
