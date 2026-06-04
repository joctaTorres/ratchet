export interface Section {
  level: number;
  title: string;
  content: string;
  children: Section[];
}

export class MarkdownParser {
  private lines: string[];
  private codeFenceLineMask: boolean[];
  private currentLine: number;

  constructor(content: string) {
    const normalized = MarkdownParser.normalizeContent(content);
    this.lines = normalized.split('\n');
    this.codeFenceLineMask = MarkdownParser.buildCodeFenceMask(this.lines);
    this.currentLine = 0;
  }

  protected static normalizeContent(content: string): string {
    return content.replace(/\r\n?/g, '\n');
  }

  protected static buildCodeFenceMask(lines: string[]): boolean[] {
    const mask = new Array(lines.length).fill(false);
    let activeFence: { marker: '`' | '~'; length: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const fence = MarkdownParser.getFenceMarker(lines[i]);

      if (!activeFence) {
        if (fence) {
          activeFence = fence;
          mask[i] = true;
        }
        continue;
      }

      mask[i] = true;
      if (MarkdownParser.isClosingFence(lines[i], activeFence)) {
        activeFence = null;
      }
    }

    return mask;
  }

  private static getFenceMarker(line: string): { marker: '`' | '~'; length: number } | null {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fenceMatch) {
      return null;
    }

    return {
      marker: fenceMatch[1][0] as '`' | '~',
      length: fenceMatch[1].length,
    };
  }

  private static isClosingFence(
    line: string,
    activeFence: { marker: '`' | '~'; length: number }
  ): boolean {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
    return Boolean(
      fenceMatch &&
      fenceMatch[1][0] === activeFence.marker &&
      fenceMatch[1].length >= activeFence.length
    );
  }

  protected parseSections(): Section[] {
    const sections: Section[] = [];
    const stack: Section[] = [];
    
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (this.codeFenceLineMask[i]) {
        continue;
      }
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      
      if (headerMatch) {
        const level = headerMatch[1].length;
        const title = headerMatch[2].trim();
        const content = this.getContentUntilNextHeader(i + 1, level);
        
        const section: Section = {
          level,
          title,
          content,
          children: [],
        };

        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }

        if (stack.length === 0) {
          sections.push(section);
        } else {
          stack[stack.length - 1].children.push(section);
        }
        
        stack.push(section);
      }
    }
    
    return sections;
  }

  protected getContentUntilNextHeader(startLine: number, currentLevel: number): string {
    const contentLines: string[] = [];
    
    for (let i = startLine; i < this.lines.length; i++) {
      const line = this.lines[i];
      const headerMatch = this.codeFenceLineMask[i] ? null : line.match(/^(#{1,6})\s+/);
      
      if (headerMatch && headerMatch[1].length <= currentLevel) {
        break;
      }
      
      contentLines.push(line);
    }
    
    return contentLines.join('\n').trim();
  }

  protected findSection(sections: Section[], title: string): Section | undefined {
    for (const section of sections) {
      if (section.title.toLowerCase() === title.toLowerCase()) {
        return section;
      }
      const child = this.findSection(section.children, title);
      if (child) {
        return child;
      }
    }
    return undefined;
  }

}
