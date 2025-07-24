// Script per debuggare il troncamento nel workflow n8n

// 1. Aggiungi questo codice in un Function node dopo la generazione del report
const debugTruncation = (data) => {
  const output = data.output || '';
  
  console.log('=== DEBUG TRUNCATION ===');
  console.log('Output length:', output.length);
  console.log('Last 200 chars:', output.slice(-200));
  
  // Verifica se ci sono sezioni incomplete
  const sections = [
    'RACCOMANDAZIONI STRATEGICHE',
    'INSIGHTS STRATEGICI',
    'ANNUNCI DETTAGLIATI'
  ];
  
  sections.forEach(section => {
    const sectionIndex = output.indexOf(section);
    if (sectionIndex > -1) {
      const sectionContent = output.substring(sectionIndex, sectionIndex + 500);
      const hasContent = sectionContent.split('\n').filter(line => line.trim().length > 0).length > 2;
      
      if (!hasContent) {
        console.log(`WARNING: Section "${section}" appears to be empty or truncated`);
      }
    }
  });
  
  // Cerca indicatori di troncamento
  const truncationIndicators = [
    /\.\.\.$/, // Ends with ...
    /[a-z]$/, // Ends with lowercase letter (unusual)
    /\w+$/, // Ends mid-word
  ];
  
  truncationIndicators.forEach((pattern, i) => {
    if (pattern.test(output.trim())) {
      console.log(`WARNING: Output may be truncated (pattern ${i})`);
    }
  });
  
  return data;
};

// 2. Verifica limiti nei nodi
const checkNodeLimits = () => {
  // In ogni HTTP Request node, verifica:
  return {
    maxBodyLength: 10000000, // 10MB
    maxContentLength: 10000000,
    timeout: 300000, // 5 minuti
  };
};

// 3. Split del contenuto se troppo grande
const splitLargeContent = (content) => {
  const MAX_SIZE = 50000; // 50KB chunks
  
  if (content.length <= MAX_SIZE) {
    return { isSplit: false, content };
  }
  
  const chunks = [];
  for (let i = 0; i < content.length; i += MAX_SIZE) {
    chunks.push(content.slice(i, i + MAX_SIZE));
  }
  
  return {
    isSplit: true,
    chunks: chunks,
    totalChunks: chunks.length
  };
};

// 4. Validazione del report completo
const validateReport = (report) => {
  const requiredSections = [
    '## 📊 PANORAMICA DEL SETTORE',
    '## 🏢 PLAYER DEL SETTORE',
    '## 💬 ANALISI MESSAGING SETTORIALE',
    '## 🎨 CREATIVE STRATEGY INSIGHTS',
    '## 📱 ANNUNCI DETTAGLIATI',
    '## 💡 INSIGHTS STRATEGICI OSSERVABILI',
    '## 🎯 RACCOMANDAZIONI STRATEGICHE'
  ];
  
  const missingSections = [];
  const emptySections = [];
  
  requiredSections.forEach(section => {
    const index = report.indexOf(section);
    if (index === -1) {
      missingSections.push(section);
    } else {
      // Check if section has content (at least 100 chars after title)
      const nextSectionIndex = report.indexOf('##', index + 3);
      const sectionContent = nextSectionIndex > -1 
        ? report.substring(index, nextSectionIndex)
        : report.substring(index);
      
      if (sectionContent.length < 150) { // Title + at least some content
        emptySections.push(section);
      }
    }
  });
  
  return {
    isValid: missingSections.length === 0 && emptySections.length === 0,
    missingSections,
    emptySections,
    reportLength: report.length
  };
};

// Esporta le funzioni per uso in n8n
module.exports = {
  debugTruncation,
  checkNodeLimits,
  splitLargeContent,
  validateReport
};