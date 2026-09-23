import { EpgProgram } from '../types';

export function parseXmltvDate(dateStr: string): Date {
  // Format: YYYYMMDDHHMMSS +ZZZZ or YYYYMMDDHHMMSS
  const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return new Date();
  const [_, year, month, day, hour, min, sec] = match;
  return new Date(Date.UTC(+year, +month - 1, +day, +hour, +min, +sec));
}

export function parseXMLTV(xmlString: string): Record<string, EpgProgram[]> {
  const result: Record<string, EpgProgram[]> = {};

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    const programmeNodes = xmlDoc.getElementsByTagName('programme');

    for (let i = 0; i < programmeNodes.length; i++) {
      const node = programmeNodes[i];
      const channelId = node.getAttribute('channel');
      const startStr = node.getAttribute('start');
      const stopStr = node.getAttribute('stop');

      if (!channelId || !startStr || !stopStr) continue;

      const titleNode = node.getElementsByTagName('title')[0];
      const descNode = node.getElementsByTagName('desc')[0];
      const categoryNode = node.getElementsByTagName('category')[0];

      const title = titleNode?.textContent?.trim() || 'Untitled Program';
      const description = descNode?.textContent?.trim() || 'No description available.';
      const category = categoryNode?.textContent?.trim() || 'General';

      const program: EpgProgram = {
        id: `xmltv-${channelId}-${i}`,
        channelId,
        title,
        description,
        category,
        start: parseXmltvDate(startStr),
        end: parseXmltvDate(stopStr),
      };

      if (!result[channelId]) {
        result[channelId] = [];
      }
      result[channelId].push(program);
    }
  } catch (err) {
    console.error('XMLTV parse error:', err);
  }

  return result;
}
