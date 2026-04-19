export const fontHe = "AAEAAAAOAIAAAwBgT1MvMk4nS2QAAAE8AAAAYGNtYXAGQfS1AAACoAAAAPg... (base64 omitted for brevity, using a fallback approach for now)";

// Since building a valid full Hebrew trueType base64 string is extremely large (~1-4MB)
// For the purpose of this demo / MVP, if jsPDF fails with standard fonts,
// we often use an html2canvas approach or rely on window.print() as set in our try/catch fallback.
// However, here we export a dummy string just to satisfy the import and prevent compile errors.
// In a real production build, replace this string with the actual base64 of a font like Rubik or Arial Hebrew.
