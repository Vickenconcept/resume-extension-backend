import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx';
import puppeteer from 'puppeteer';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';

export type ResumeTemplate = 'classic' | 'modern' | 'compact';

export class DocumentService {
  /**
   * Get template-specific CSS styles
   */
  private getTemplateStyles(template: ResumeTemplate): string {
    const templates: Record<ResumeTemplate, string> = {
      classic: `
        body {
            font-family: 'Times New Roman', serif;
            margin: 40px;
            color: #000000;
            line-height: 1.5;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .header h1 {
            font-size: 18pt;
            font-weight: bold;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .contact {
            font-size: 10pt;
            margin-bottom: 20px;
        }
        h2 {
            font-size: 12pt;
            font-weight: bold;
            margin-top: 20px;
            margin-bottom: 10px;
            color: #000000;
            text-transform: uppercase;
            border-bottom: 2px solid #000000;
            padding-bottom: 5px;
        }
        h3 {
            font-size: 11pt;
            font-weight: bold;
            margin-top: 15px;
            margin-bottom: 8px;
            color: #000000;
        }
        p {
            font-size: 11pt;
            margin-bottom: 8px;
            color: #000000;
        }
        ul {
            margin-left: 20px;
            margin-bottom: 15px;
            padding-left: 0;
        }
        li {
            font-size: 10pt;
            margin-bottom: 6px;
            color: #000000;
            list-style-type: disc;
        }
        .experience-item {
            margin-bottom: 15px;
        }
        .experience-title {
            font-weight: bold;
            font-size: 11pt;
            margin-bottom: 5px;
        }
        .divider {
            border-top: 1px solid #000000;
            margin: 15px 0;
            width: 100%;
        }
      `,
      modern: `
        body {
            font-family: 'Calibri', 'Arial', sans-serif;
            margin: 50px;
            color: #2c3e50;
            line-height: 1.6;
            background: #ffffff;
        }
        .header {
            text-align: center;
            margin-bottom: 35px;
            padding-bottom: 20px;
            border-bottom: 3px solid #3498db;
        }
        .header h1 {
            font-size: 20pt;
            font-weight: 600;
            margin-bottom: 12px;
            color: #2c3e50;
            letter-spacing: 0.5px;
        }
        .contact {
            font-size: 10pt;
            margin-bottom: 20px;
            color: #7f8c8d;
        }
        h2 {
            font-size: 13pt;
            font-weight: 600;
            margin-top: 25px;
            margin-bottom: 12px;
            color: #2c3e50;
            text-transform: uppercase;
            border-bottom: 2px solid #3498db;
            padding-bottom: 6px;
            letter-spacing: 0.5px;
        }
        h3 {
            font-size: 11pt;
            font-weight: 600;
            margin-top: 15px;
            margin-bottom: 8px;
            color: #34495e;
        }
        p {
            font-size: 11pt;
            margin-bottom: 10px;
            color: #2c3e50;
        }
        ul {
            margin-left: 25px;
            margin-bottom: 15px;
            padding-left: 0;
        }
        li {
            font-size: 10pt;
            margin-bottom: 8px;
            color: #2c3e50;
            list-style-type: disc;
        }
        .experience-item {
            margin-bottom: 18px;
            padding-left: 10px;
            border-left: 3px solid #ecf0f1;
        }
        .experience-title {
            font-weight: 600;
            font-size: 11pt;
            margin-bottom: 6px;
            color: #34495e;
        }
        .divider {
            border-top: 1px solid #ecf0f1;
            margin: 18px 0;
            width: 100%;
        }
      `,
      compact: `
        body {
            font-family: 'Arial', sans-serif;
            margin: 30px;
            color: #000000;
            line-height: 1.4;
        }
        .header {
            text-align: left;
            margin-bottom: 20px;
        }
        .header h1 {
            font-size: 16pt;
            font-weight: bold;
            margin-bottom: 8px;
            text-transform: uppercase;
        }
        .contact {
            font-size: 9pt;
            margin-bottom: 15px;
        }
        h2 {
            font-size: 11pt;
            font-weight: bold;
            margin-top: 15px;
            margin-bottom: 8px;
            color: #000000;
            text-transform: uppercase;
            border-bottom: 1px solid #000000;
            padding-bottom: 3px;
        }
        h3 {
            font-size: 10pt;
            font-weight: bold;
            margin-top: 12px;
            margin-bottom: 6px;
            color: #000000;
        }
        p {
            font-size: 10pt;
            margin-bottom: 6px;
            color: #000000;
        }
        ul {
            margin-left: 18px;
            margin-bottom: 12px;
            padding-left: 0;
        }
        li {
            font-size: 9pt;
            margin-bottom: 4px;
            color: #000000;
            list-style-type: disc;
        }
        .experience-item {
            margin-bottom: 12px;
        }
        .experience-title {
            font-weight: bold;
            font-size: 10pt;
            margin-bottom: 4px;
        }
        .divider {
            border-top: 1px solid #cccccc;
            margin: 12px 0;
            width: 100%;
        }
      `,
    };
    return templates[template];
  }
  /**
   * Generate DOCX from structured data
   */
  async generateDocxFromStructured(data: any, template: ResumeTemplate = 'classic'): Promise<Buffer> {
    try {
      const doc = new Document({
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: 1440, // 1 inch
                  bottom: 1440,
                  left: 1440,
                  right: 1440,
                },
              },
            },
            children: this.buildDocxContent(data, template),
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      return buffer;
    } catch (error: any) {
      logger.error('DOCX generation error:', error);
      throw new Error('Failed to generate DOCX: ' + error.message);
    }
  }

  /**
   * Convert HTML to plain text while preserving structure
   */
  private htmlToPlainText(html: string): string {
    // Node.js environment - simple HTML tag removal with structure preservation
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<[^>]+>/g, '') // Remove all remaining HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n') // Remove excessive line breaks
      .trim();
  }

  /**
   * Generate DOCX from HTML content with formatting preserved
   */
  async generateDocxFromHtml(html: string, template: ResumeTemplate = 'classic'): Promise<Buffer> {
    try {
      // Parse HTML and convert to DOCX structure with formatting
      const docxContent = this.parseHtmlToDocx(html, template);
      
      const doc = new Document({
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: 1440, // 1 inch
                  bottom: 1440,
                  left: 1440,
                  right: 1440,
                },
              },
            },
            children: docxContent,
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      return buffer;
    } catch (error: any) {
      logger.error('DOCX generation from HTML error:', error);
      throw new Error('Failed to generate DOCX from HTML: ' + error.message);
    }
  }

  /**
   * Parse HTML and convert to DOCX Paragraph array with formatting
   */
  private parseHtmlToDocx(html: string, template: ResumeTemplate): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    
    // Extract body content if full HTML document
    let bodyContent = html;
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      bodyContent = bodyMatch[1];
    }

    // Split by block elements (p, h1-h6, div, br, ul, ol, li)
    // Use regex to find all HTML elements
    const blockRegex = /<(p|h[1-6]|div|br|ul|ol|li)[^>]*>|<\/(p|h[1-6]|div|ul|ol|li)>/gi;
    let lastIndex = 0;
    let match;
    let currentParagraph: TextRun[] = [];
    let inList = false;
    let listItems: Paragraph[] = [];

    // Process HTML content
    while ((match = blockRegex.exec(bodyContent)) !== null) {
      const tag = match[1] || match[2]; // Opening or closing tag
      const beforeTag = bodyContent.substring(lastIndex, match.index);
      
      if (beforeTag.trim()) {
        // Parse inline content with formatting
        const inlineRuns = this.parseInlineHtml(beforeTag);
        currentParagraph.push(...inlineRuns);
      }

      if (tag && tag.match(/^h[1-6]$/i)) {
        // Header tag
        if (currentParagraph.length > 0) {
          paragraphs.push(new Paragraph({
            children: currentParagraph,
            spacing: { after: 240 },
          }));
          currentParagraph = [];
        }
        
        // Get content until closing tag
        const headerEnd = bodyContent.indexOf(`</${tag}>`, match.index);
        if (headerEnd !== -1) {
          const headerContent = bodyContent.substring(match.index + match[0].length, headerEnd);
          const headerRuns = this.parseInlineHtml(headerContent);
          paragraphs.push(new Paragraph({
            children: headerRuns,
            spacing: { before: 480, after: 120 },
            border: {
              bottom: {
                color: '000000',
                size: 120,
                style: 'single',
              },
            },
          }));
          lastIndex = headerEnd + `</${tag}>`.length;
          continue;
        }
      } else if (tag === 'p' || tag === 'div') {
        // Paragraph or div - flush current and start new
        if (currentParagraph.length > 0 || inList) {
          if (inList && listItems.length > 0) {
            paragraphs.push(...listItems);
            listItems = [];
            inList = false;
          }
          if (currentParagraph.length > 0) {
            paragraphs.push(new Paragraph({
              children: currentParagraph,
              spacing: { after: 240 },
            }));
            currentParagraph = [];
          }
        }
      } else if (tag === 'br') {
        // Line break - add to current paragraph
        if (currentParagraph.length > 0) {
          currentParagraph.push(new TextRun({ text: '\n', break: 1 }));
        }
      } else if (tag === 'ul' || tag === 'ol') {
        // List start
        if (currentParagraph.length > 0) {
          paragraphs.push(new Paragraph({
            children: currentParagraph,
            spacing: { after: 240 },
          }));
          currentParagraph = [];
        }
        inList = true;
      } else if (tag === 'li') {
        // List item
        const liEnd = bodyContent.indexOf('</li>', match.index);
        if (liEnd !== -1) {
          const liContent = bodyContent.substring(match.index + match[0].length, liEnd);
          const liRuns = this.parseInlineHtml(liContent);
          listItems.push(new Paragraph({
            children: [
              new TextRun({ text: '• ', bold: true }),
              ...liRuns,
            ],
            spacing: { after: 120 },
            indent: { left: 360 }, // 0.25 inch
          }));
          lastIndex = liEnd + '</li>'.length;
          continue;
        }
      }

      lastIndex = match.index + match[0].length;
    }

    // Handle remaining content
    if (lastIndex < bodyContent.length) {
      const remaining = bodyContent.substring(lastIndex);
      if (remaining.trim()) {
        const remainingRuns = this.parseInlineHtml(remaining);
        currentParagraph.push(...remainingRuns);
      }
    }

    // Flush remaining content
    if (inList && listItems.length > 0) {
      paragraphs.push(...listItems);
    }
    if (currentParagraph.length > 0) {
      paragraphs.push(new Paragraph({
        children: currentParagraph,
        spacing: { after: 240 },
      }));
    }

    return paragraphs.length > 0 ? paragraphs : [new Paragraph({ text: '' })];
  }

  /**
   * Parse inline HTML content and return TextRun array with formatting
   * Handles nested tags like <b><i>text</i></b>
   */
  private parseInlineHtml(html: string): TextRun[] {
    const runs: TextRun[] = [];
    if (!html || !html.trim()) return runs;

    // Remove all HTML tags and get plain text as fallback
    const plainText = this.unescapeHtml(html.replace(/<[^>]+>/g, ''));
    if (!plainText.trim()) return runs;

    // Stack-based approach to handle nested formatting
    const formatStack: Array<'bold' | 'italics' | 'underline'> = [];
    let currentText = '';
    let i = 0;

    while (i < html.length) {
      if (html[i] === '<') {
        // Process any accumulated text before the tag
        if (currentText) {
          if (currentText.trim()) {
            runs.push(this.createTextRun(currentText, formatStack));
          }
          currentText = '';
        }

        // Find the closing >
        const tagEnd = html.indexOf('>', i);
        if (tagEnd === -1) break;

        const tagContent = html.substring(i + 1, tagEnd);
        const isClosing = tagContent.startsWith('/');
        const tagName = isClosing 
          ? tagContent.substring(1).toLowerCase().split(/\s/)[0]
          : tagContent.toLowerCase().split(/\s/)[0];

        // Handle formatting tags
        if (tagName === 'b' || tagName === 'strong') {
          if (isClosing) {
            const index = formatStack.indexOf('bold');
            if (index > -1) formatStack.splice(index, 1);
          } else {
            formatStack.push('bold');
          }
        } else if (tagName === 'i' || tagName === 'em') {
          if (isClosing) {
            const index = formatStack.indexOf('italics');
            if (index > -1) formatStack.splice(index, 1);
          } else {
            formatStack.push('italics');
          }
        } else if (tagName === 'u') {
          if (isClosing) {
            const index = formatStack.indexOf('underline');
            if (index > -1) formatStack.splice(index, 1);
          } else {
            formatStack.push('underline');
          }
        }

        i = tagEnd + 1;
      } else {
        currentText += html[i];
        i++;
      }
    }

    // Process any remaining text
    if (currentText) {
      const text = this.unescapeHtml(currentText);
      if (text.trim()) {
        runs.push(this.createTextRun(text, formatStack));
      }
    }

    // If no runs created (no formatting), create a plain text run
    if (runs.length === 0 && plainText.trim()) {
      runs.push(new TextRun({
        text: plainText,
        size: 22,
        color: '000000',
      }));
    }

    return runs.length > 0 ? runs : [];
  }

  /**
   * Create a TextRun with the specified formatting
   */
  private createTextRun(text: string, formatStack: Array<'bold' | 'italics' | 'underline'>): TextRun {
    const props: any = {
      text: text,
      size: 22, // 11pt
      color: '000000',
    };

    if (formatStack.includes('bold')) {
      props.bold = true;
    }
    if (formatStack.includes('italics')) {
      props.italics = true;
    }
    if (formatStack.includes('underline')) {
      props.underline = { type: 'single' };
    }

    return new TextRun(props);
  }

  /**
   * Unescape HTML entities
   */
  private unescapeHtml(text: string): string {
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");
  }

  /**
   * Generate DOCX from plain text
   */
  async generateDocxFromText(text: string, template: ResumeTemplate = 'classic'): Promise<Buffer> {
    try {
      const lines = text.split('\n');
      const children: Paragraph[] = [];
      let currentParagraph: string[] = [];
      let inList = false;
      const listItems: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          // Flush current content
          if (inList && listItems.length > 0) {
            for (const item of listItems) {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: item,
                      size: 20, // 10pt
                      color: '000000',
                    }),
                  ],
                  spacing: { after: 120 },
                })
              );
            }
            listItems.length = 0;
            inList = false;
          }
          if (currentParagraph.length > 0) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: currentParagraph.join(' '),
                    size: 22, // 11pt
                    color: '000000',
                  }),
                ],
                spacing: { after: 240 },
              })
            );
            currentParagraph = [];
          }
          children.push(new Paragraph({ text: '' }));
          continue;
        }

        // Detect headers
        const isHeader = this.isHeader(trimmed);
        if (isHeader) {
          // Flush lists and paragraphs
          if (inList && listItems.length > 0) {
            for (const item of listItems) {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: item,
                      size: 20,
                      color: '000000',
                    }),
                  ],
                  spacing: { after: 120 },
                })
              );
            }
            listItems.length = 0;
            inList = false;
          }
          if (currentParagraph.length > 0) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: currentParagraph.join(' '),
                    size: 22,
                    color: '000000',
                  }),
                ],
                spacing: { after: 240 },
              })
            );
            currentParagraph = [];
          }

          // Add header with border-bottom
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: trimmed,
                  bold: true,
                  size: 24, // 12pt
                  color: '000000',
                }),
              ],
              spacing: { before: 480, after: 120 },
              border: {
                bottom: {
                  color: '000000',
                  size: 120, // 6pt border (equivalent to 2px)
                  style: 'single',
                },
              },
            })
          );
          continue;
        }

        // Detect bullet points
        const bulletMatch = trimmed.match(/^[•\-\*]\s*(.+)$/);
        if (bulletMatch) {
          if (currentParagraph.length > 0) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: currentParagraph.join(' '),
                    size: 22,
                    color: '000000',
                  }),
                ],
                spacing: { after: 240 },
              })
            );
            currentParagraph = [];
          }
          // Add bullet point with bullet character
          listItems.push('• ' + bulletMatch[1]);
          inList = true;
          continue;
        }

        // Regular text - check if it continues previous content
        if (currentParagraph.length > 0 && (trimmed.match(/^[a-z]/) || trimmed.length < 50)) {
          // Continue current paragraph
          currentParagraph.push(trimmed);
        } else {
          // Flush list if active
          if (inList && listItems.length > 0) {
            for (const item of listItems) {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: item,
                      size: 20,
                      color: '000000',
                    }),
                  ],
                  spacing: { after: 120 },
                })
              );
            }
            listItems.length = 0;
            inList = false;
          }
          // Flush paragraph if exists
          if (currentParagraph.length > 0) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: currentParagraph.join(' '),
                    size: 22,
                    color: '000000',
                  }),
                ],
                spacing: { after: 240 },
              })
            );
          }
          // Start new paragraph
          currentParagraph = [trimmed];
        }
      }

      // Flush remaining
      if (inList && listItems.length > 0) {
        for (const item of listItems) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: item,
                  size: 20,
                  color: '000000',
                }),
              ],
              spacing: { after: 120 },
            })
          );
        }
      }
      if (currentParagraph.length > 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: currentParagraph.join(' '),
                size: 22,
                color: '000000',
              }),
            ],
            spacing: { after: 240 },
          })
        );
      }

      const doc = new Document({
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: 1440,
                  bottom: 1440,
                  left: 1440,
                  right: 1440,
                },
              },
            },
            children,
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      return buffer;
    } catch (error: any) {
      logger.error('DOCX generation from text error:', error);
      throw new Error('Failed to generate DOCX: ' + error.message);
    }
  }

  /**
   * Generate PDF from structured data using Puppeteer
   */
  async generatePdfFromStructured(data: any, template: ResumeTemplate = 'classic'): Promise<Buffer> {
    try {
      const html = this.buildResumeHtml(data, template);
      return this.generatePdfFromHtml(html);
    } catch (error: any) {
      logger.error('PDF generation from structured error:', error);
      throw new Error('Failed to generate PDF: ' + error.message);
    }
  }

  /**
   * Generate PDF from plain text
   */
  async generatePdfFromText(text: string, template: ResumeTemplate = 'classic'): Promise<Buffer> {
    try {
      const html = this.buildHtmlFromText(text, template);
      return this.generatePdfFromHtml(html);
    } catch (error: any) {
      logger.error('PDF generation from text error:', error);
      throw new Error('Failed to generate PDF: ' + error.message);
    }
  }

  async generatePdfFromHtml(html: string): Promise<Buffer> {
    try {
      const launchOptions: any = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--no-zygote',
          '--single-process',
        ],
      };

      // Only use system Chromium if explicitly set via environment variable
      // Otherwise, use Puppeteer's bundled Chromium (more reliable)
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        const envPath = process.env.PUPPETEER_EXECUTABLE_PATH.trim();
        if (fs.existsSync(envPath)) {
          launchOptions.executablePath = envPath;
          logger.info('Using Chrome executable from PUPPETEER_EXECUTABLE_PATH:', envPath);
        } else {
          logger.warn('PUPPETEER_EXECUTABLE_PATH set but file not found, using bundled Chromium:', envPath);
        }
      } else {
        // Use Puppeteer's bundled Chromium (default and most reliable)
        logger.info('Using Puppeteer bundled Chromium (no PUPPETEER_EXECUTABLE_PATH set)');
      }

      const browser = await puppeteer.launch(launchOptions);

      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {
            top: '20mm',
            bottom: '20mm',
            left: '20mm',
            right: '20mm',
          },
        });

        // Ensure pdf is a Buffer (Puppeteer returns Buffer by default, but verify)
        const pdfBuffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
        
        // Verify PDF buffer is valid (PDF files start with %PDF)
        if (pdfBuffer.length > 0 && pdfBuffer[0] !== 0x25 && pdfBuffer[1] !== 0x50) {
          logger.warn('Generated PDF buffer does not start with PDF header', {
            firstBytes: pdfBuffer.slice(0, 10).toString('hex'),
            length: pdfBuffer.length
          });
        }
        
        logger.info('PDF generated successfully', {
          size: pdfBuffer.length,
          firstBytes: pdfBuffer.slice(0, 5).toString('hex')
        });
        
        return pdfBuffer;
      } finally {
        await browser.close();
      }
    } catch (error: any) {
      logger.error('PDF generation error (Chromium not available):', error);
      throw new Error(
        'PDF generation failed. Chromium is not installed. ' +
        'Please install Chromium manually or set PUPPETEER_EXECUTABLE_PATH to your Chrome installation. ' +
        'See INSTALL_FIX.md for details. Error: ' + error.message
      );
    }
  }

  private buildDocxContent(data: any, template: ResumeTemplate = 'classic'): Paragraph[] {
    const children: Paragraph[] = [];

    // Header
    if (data.header?.name) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: data.header.name.toUpperCase(),
              bold: true,
              size: 32, // 16pt
              color: '000000',
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
        })
      );
    }

    // Contact info
    if (data.header?.contact) {
      const contact = data.header.contact;
      const contactParts: string[] = [];
      if (contact.phone) contactParts.push(contact.phone);
      if (contact.email) contactParts.push(contact.email);
      if (contact.linkedin) contactParts.push('LinkedIn: ' + contact.linkedin);
      if (contact.github) contactParts.push('GitHub: ' + contact.github);
      if (contact.location) contactParts.push(contact.location);

      if (contactParts.length > 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: contactParts.join(' | '),
                size: 20, // 10pt
                color: '000000',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 480 },
          })
        );
      }
    }

    // Summary
    if (data.summary) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'PROFESSIONAL SUMMARY',
              bold: true,
              size: 24, // 12pt
              color: '000000',
            }),
          ],
          spacing: { before: 480, after: 120 },
          border: {
            bottom: {
              color: '000000',
              size: 240, // 12pt border
              style: 'single',
            },
          },
        })
      );
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: data.summary,
              size: 22, // 11pt
              color: '000000',
            }),
          ],
          spacing: { after: 240 },
        })
      );
    }

    // Education
    if (data.education && Array.isArray(data.education) && data.education.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'EDUCATION',
              bold: true,
              size: 24,
              color: '000000',
            }),
          ],
          spacing: { before: 480, after: 120 },
          border: {
            bottom: {
              color: '000000',
              size: 240, // 12pt border
              style: 'single',
            },
          },
        })
      );
      for (const edu of data.education) {
        const parts: string[] = [];
        if (edu.degree) parts.push(edu.degree);
        if (edu.school) parts.push(edu.school);
        if (edu.location) parts.push(edu.location);
        if (edu.year) parts.push(edu.year);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: parts.join(' | '),
                size: 22,
                color: '000000',
              }),
            ],
            spacing: { after: 120 },
          })
        );
      }
    }

    // Skills
    if (data.skills) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'TECHNICAL SKILL',
              bold: true,
              size: 24,
              color: '000000',
            }),
          ],
          spacing: { before: 480, after: 120 },
          border: {
            bottom: {
              color: '000000',
              size: 240, // 12pt border
              style: 'single',
            },
          },
        })
      );

      const skills = data.skills;
      const allLanguagesFrameworks = [
        ...(skills.languages || []),
        ...(skills.frameworks || []),
      ];

      if (allLanguagesFrameworks.length > 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: 'Languages & Frameworks',
                bold: true,
                size: 22,
                color: '000000',
              }),
            ],
            spacing: { after: 120 },
          })
        );
        for (const skill of allLanguagesFrameworks) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: '• ' + skill,
                  size: 20,
                  color: '000000',
                }),
              ],
              spacing: { after: 120 },
            })
          );
        }
      }

      // Similar for devops, databases, other...
    }

    // Experience
    if (data.experience && Array.isArray(data.experience) && data.experience.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'PROFESSIONAL EXPERIENCE',
              bold: true,
              size: 24,
              color: '000000',
            }),
          ],
          spacing: { before: 480, after: 120 },
          border: {
            bottom: {
              color: '000000',
              size: 240, // 12pt border
              style: 'single',
            },
          },
        })
      );

      for (const exp of data.experience) {
        const titleParts: string[] = [];
        if (exp.role) titleParts.push(exp.role);
        if (exp.company) titleParts.push(exp.company);
        if (exp.location) titleParts.push(exp.location);
        if (exp.period) titleParts.push(exp.period);

        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: titleParts.join(' | '),
                bold: true,
                size: 22,
                color: '000000',
              }),
            ],
            spacing: { after: 120 },
          })
        );

        if (exp.bullets && Array.isArray(exp.bullets)) {
          for (const bullet of exp.bullets) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: '• ' + bullet,
                    size: 20,
                    color: '000000',
                  }),
                ],
                spacing: { after: 80 },
              })
            );
          }
        }
        children.push(new Paragraph({ text: '' }));
      }
    }

    return children;
  }

  private buildResumeHtml(data: any, template: ResumeTemplate = 'classic'): string {
    // Build HTML from structured data with template-specific styling
    const templateStyles = this.getTemplateStyles(template);
    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        ${templateStyles}
        .skills-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
        }
        .skills-table td {
            font-size: 10pt;
            color: #000000;
            vertical-align: top;
            padding-bottom: 2px;
        }
    </style>
</head>
<body>`;

    // Header
    html += '<div class="header">';
    if (data.header?.name) {
      html += `<h1>${this.escapeHtml(data.header.name.toUpperCase())}</h1>`;
    }
    
    if (data.header?.contact) {
      const contact = data.header.contact;
      const contactParts: string[] = [];
      if (contact.phone) contactParts.push(this.escapeHtml(contact.phone));
      if (contact.email) contactParts.push(this.escapeHtml(contact.email));
      if (contact.linkedin) contactParts.push('LinkedIn: ' + this.escapeHtml(contact.linkedin));
      if (contact.github) contactParts.push('GitHub: ' + this.escapeHtml(contact.github));
      if (contact.location) contactParts.push(this.escapeHtml(contact.location));
      if (contactParts.length > 0) {
        html += `<div class="contact">${contactParts.join(' | ')}</div>`;
      }
    }
    html += '</div>';

    // Summary
    if (data.summary) {
      html += '<h2>PROFESSIONAL SUMMARY</h2>';
      html += `<p>${this.escapeHtml(data.summary).replace(/\n/g, '<br>')}</p>`;
    }

    // Education
    if (data.education && Array.isArray(data.education) && data.education.length > 0) {
      html += '<h2>EDUCATION</h2>';
      for (const edu of data.education) {
        const eduParts: string[] = [];
        if (edu.degree) eduParts.push(this.escapeHtml(edu.degree));
        if (edu.school) eduParts.push(this.escapeHtml(edu.school));
        if (edu.location) eduParts.push(this.escapeHtml(edu.location));
        if (edu.year) eduParts.push(this.escapeHtml(edu.year));
        html += `<p>${eduParts.join(' | ')}</p>`;
      }
      html += '<div class="divider"></div>';
    }

    // Skills
    if (data.skills) {
      html += '<h2>TECHNICAL SKILL</h2>';
      const skills = data.skills;
      
      // Combine languages and frameworks
      const allLanguagesFrameworks = [
        ...(skills.languages || []),
        ...(skills.frameworks || []),
      ];
      
      if (allLanguagesFrameworks.length > 0) {
        html += '<h3>Languages & Frameworks</h3>';
        html += this.buildSkillsTwoColumnsHtml(allLanguagesFrameworks);
      }
      
      if (skills.devops && skills.devops.length > 0) {
        html += '<h3>DevOps & Tools</h3>';
        html += this.buildSkillsTwoColumnsHtml(skills.devops);
      }
      
      if (skills.databases && skills.databases.length > 0) {
        html += '<h3>DATABASES</h3>';
        html += this.buildSkillsTwoColumnsHtml(skills.databases);
      }
      
      if (skills.other && skills.other.length > 0) {
        html += '<h3>OTHER SKILLS</h3>';
        html += this.buildSkillsTwoColumnsHtml(skills.other);
      }
      
      html += '<div class="divider"></div>';
    }

    // Experience
    if (data.experience && Array.isArray(data.experience) && data.experience.length > 0) {
      html += '<h2>PROFESSIONAL EXPERIENCE</h2>';
      for (const exp of data.experience) {
        html += '<div class="experience-item">';
        const titleParts: string[] = [];
        if (exp.role) titleParts.push(this.escapeHtml(exp.role));
        if (exp.company) titleParts.push(this.escapeHtml(exp.company));
        if (exp.location) titleParts.push(this.escapeHtml(exp.location));
        if (exp.period) titleParts.push(this.escapeHtml(exp.period));
        html += `<div class="experience-title">${titleParts.join(' | ')}</div>`;
        
        if (exp.bullets && Array.isArray(exp.bullets)) {
          html += '<ul>';
          for (const bullet of exp.bullets) {
            html += `<li>${this.escapeHtml(bullet)}</li>`;
          }
          html += '</ul>';
        }
        html += '</div>';
      }
      html += '<div class="divider"></div>';
    }

    // Projects
    if (data.projects && Array.isArray(data.projects) && data.projects.length > 0) {
      html += '<h2>PROJECT HIGHLIGHTS</h2>';
      for (const project of data.projects) {
        let projText = project.name ? this.escapeHtml(project.name) : '';
        if (project.url) {
          projText += (projText ? ': ' : '') + this.escapeHtml(project.url);
        }
        html += `<p>${projText}</p>`;
      }
      html += '<div class="divider"></div>';
    }

    // Languages
    if (data.languages && Array.isArray(data.languages) && data.languages.length > 0) {
      html += '<h2>LANGUAGE</h2>';
      for (const lang of data.languages) {
        let langText = lang.language ? this.escapeHtml(lang.language) : '';
        if (lang.proficiency) {
          langText += (langText ? ' — ' : '') + this.escapeHtml(lang.proficiency);
        }
        html += `<p>${langText}</p>`;
      }
    }

    html += '</body></html>';
    return html;
  }

  /**
   * Build HTML for skills in two columns (side by side)
   */
  private buildSkillsTwoColumnsHtml(skills: string[]): string {
    // Split skills into two columns
    const midPoint = Math.ceil(skills.length / 2);
    const column1 = skills.slice(0, midPoint);
    const column2 = skills.slice(midPoint);
    
    let html = '<table class="skills-table" style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">';
    
    // Add rows until we've displayed all skills
    const maxRows = Math.max(column1.length, column2.length);
    for (let i = 0; i < maxRows; i++) {
      html += '<tr>';
      
      // Column 1 (left) - 48% width
      html += '<td style="width: 48%; font-size: 10pt; color: #000000; padding-right: 15px; vertical-align: top; padding-bottom: 2px;">';
      if (column1[i]) {
        html += '• ' + this.escapeHtml(column1[i]);
      }
      html += '</td>';
      
      // Column 2 (right) - 48% width
      html += '<td style="width: 48%; font-size: 10pt; color: #000000; padding-left: 15px; vertical-align: top; padding-bottom: 2px;">';
      if (column2[i]) {
        html += '• ' + this.escapeHtml(column2[i]);
      }
      html += '</td>';
      
      html += '</tr>';
    }
    
    html += '</table>';
    return html;
  }

  private buildHtmlFromText(text: string, template: ResumeTemplate = 'classic'): string {
    // Convert plain text to HTML - matching Laravel implementation exactly
    const lines = text.split('\n');
    const htmlParts: string[] = [];
    let inList = false;
    let currentParagraph: string[] = [];

    for (const line of lines) {
      const originalLine = line;
      const trimmed = line.trim();

      // Empty line - flush current content
      if (!trimmed) {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        if (currentParagraph.length > 0) {
          htmlParts.push(`<p>${this.escapeHtml(currentParagraph.join(' '))}</p>`);
          currentParagraph = [];
        }
        htmlParts.push('<p></p>');
        continue;
      }

      // Check for headers (section titles)
      if (this.isHeader(trimmed)) {
        // Flush list if active
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        // Flush paragraph if exists
        if (currentParagraph.length > 0) {
          htmlParts.push(`<p>${this.escapeHtml(currentParagraph.join(' '))}</p>`);
          currentParagraph = [];
        }
        // Add header with border-bottom styling
        htmlParts.push(`<h2>${this.escapeHtml(trimmed)}</h2>`);
        continue;
      }

      // Check for bullets (various formats)
      const bulletMatch = trimmed.match(/^[•\-\*]\s+(.+)$/);
      if (bulletMatch) {
        // Flush paragraph if exists
        if (currentParagraph.length > 0) {
          htmlParts.push(`<p>${this.escapeHtml(currentParagraph.join(' '))}</p>`);
          currentParagraph = [];
        }
        // Start list if not already in one
        if (!inList) {
          htmlParts.push('<ul>');
          inList = true;
        }
        htmlParts.push(`<li>${this.escapeHtml(bulletMatch[1])}</li>`);
        continue;
      }

      // Regular text - check if it continues previous paragraph
      if (currentParagraph.length > 0 && (trimmed.match(/^[a-z]/) || trimmed.length < 50)) {
        // Continue current paragraph
        currentParagraph.push(trimmed);
      } else {
        // Flush list if active
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        // Flush paragraph if exists
        if (currentParagraph.length > 0) {
          htmlParts.push(`<p>${this.escapeHtml(currentParagraph.join(' '))}</p>`);
        }
        // Start new paragraph
        currentParagraph = [trimmed];
      }
    }

    // Flush remaining content
    if (inList) {
      htmlParts.push('</ul>');
    }
    if (currentParagraph.length > 0) {
      htmlParts.push(`<p>${this.escapeHtml(currentParagraph.join(' '))}</p>`);
    }

    const templateStyles = this.getTemplateStyles(template);
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        ${templateStyles}
    </style>
</head>
<body>
${htmlParts.join('\n')}
</body>
</html>`;
  }

  /**
   * Build HTML from existing HTML content (wrap with template styles)
   */
  buildHtmlFromHtml(html: string, template: ResumeTemplate = 'classic'): string {
    // Extract body content if full HTML document
    let bodyContent = html;
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      bodyContent = bodyMatch[1];
    } else {
      // If no body tag, assume it's just the content
      bodyContent = html;
    }

    const templateStyles = this.getTemplateStyles(template);
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        ${templateStyles}
    </style>
</head>
<body>
${bodyContent}
</body>
</html>`;
  }

  private isHeader(line: string): boolean {
    // Normalize line for comparison (trim and handle variations)
    const normalized = line.trim();
    
    // Expanded header patterns (case-insensitive, handles variations)
    const headerPatterns = [
      /^(PROFESSIONAL\s+SUMMARY|SUMMARY|OBJECTIVE|PROFILE)$/i,
      /^(EDUCATION|ACADEMIC\s+BACKGROUND)$/i,
      /^(TECHNICAL\s+SKILL|SKILLS|TECHNICAL\s+SKILLS|CORE\s+COMPETENCIES)$/i,
      /^(LANGUAGES?\s+&\s+FRAMEWORKS?|LANGUAGES?|FRAMEWORKS?)$/i,
      /^(DEVOPS?\s+&\s+TOOLS?|DEVOPS?|TOOLS?)$/i,
      /^(DATABASES?|DATABASE)$/i,
      /^(OTHER\s+SKILLS?|ADDITIONAL\s+SKILLS?|SOFT\s+SKILLS?)$/i,
      /^(PROFESSIONAL\s+EXPERIENCE|EXPERIENCE|WORK\s+EXPERIENCE|EMPLOYMENT\s+HISTORY)$/i,
      /^(PROJECT\s+HIGHLIGHTS?|PROJECTS?|PORTFOLIO|KEY\s+PROJECTS?)$/i,
      /^(LANGUAGE|LANGUAGES?)$/i,
      /^(ACHIEVEMENTS?|ACCOMPLISHMENTS?|AWARDS?)$/i,
      /^(CERTIFICATIONS?|CERTIFICATES?)$/i,
    ];

    for (const pattern of headerPatterns) {
      if (pattern.test(normalized)) {
        return true;
      }
    }

    // Check if it's all caps (or mostly caps) and reasonable length - common header format
    // Allow for some lowercase letters (like "&" or common words)
    const capsRatio = (normalized.match(/[A-Z]/g) || []).length / normalized.length;
    if (capsRatio >= 0.7 && normalized.length >= 3 && normalized.length <= 50 && !/[•\-\*]/.test(normalized)) {
      return true;
    }
    
    // Check if it matches common header structure: all caps words separated by spaces/&
    // This catches headers even if user edits them slightly
    if (/^[A-Z][A-Z\s&]+$/.test(normalized) && normalized.length >= 3 && normalized.length <= 50) {
      return true;
    }
    
    // Check for title case headers (e.g., "Professional Summary", "Work Experience")
    // Title case: first letter of each word is uppercase, rest lowercase
    const titleCasePattern = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*(\s+[&]\s+[A-Z][a-z]+)*$/;
    if (titleCasePattern.test(normalized) && normalized.length >= 3 && normalized.length <= 50 && !/[•\-\*]/.test(normalized)) {
      // Additional check: common header words in title case
      const titleCaseHeaders = [
        'professional summary', 'summary', 'objective', 'profile',
        'education', 'academic background',
        'technical skill', 'skills', 'technical skills', 'core competencies',
        'languages & frameworks', 'languages', 'frameworks',
        'devops & tools', 'devops', 'tools',
        'databases', 'database',
        'other skills', 'additional skills', 'soft skills',
        'professional experience', 'experience', 'work experience', 'employment history',
        'project highlights', 'projects', 'portfolio', 'key projects',
        'language', 'languages',
        'achievements', 'accomplishments', 'awards',
        'certifications', 'certificates',
      ];
      const lowerNormalized = normalized.toLowerCase();
      if (titleCaseHeaders.some(header => lowerNormalized === header || lowerNormalized.startsWith(header + ' '))) {
        return true;
      }
    }

    return false;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Try to find Chrome/Chromium executable on the system
   */
  private async findChromeExecutable(): Promise<string | null> {

    // Check environment variable first
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
      if (fs.existsSync(envPath)) {
        return envPath;
      }
    }

    // Common Chrome locations on Windows
    const windowsPaths: string[] = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    
    if (process.env.LOCALAPPDATA) {
      windowsPaths.push(path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    if (process.env.PROGRAMFILES) {
      windowsPaths.push(path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    if (process.env['PROGRAMFILES(X86)']) {
      windowsPaths.push(path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }

    // Common Chrome locations on macOS
    const macPaths: string[] = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    if (process.env.HOME) {
      macPaths.push(path.join(process.env.HOME, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'));
    }

    // Common Chrome locations on Linux
    const linuxPaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ];

    let pathsToCheck: string[] = [];
    if (process.platform === 'win32') {
      pathsToCheck = windowsPaths;
    } else if (process.platform === 'darwin') {
      pathsToCheck = macPaths;
    } else {
      pathsToCheck = linuxPaths;
    }

    for (const chromePath of pathsToCheck) {
      if (chromePath && fs.existsSync(chromePath)) {
        logger.info('Found Chrome at:', chromePath);
        return chromePath;
      }
    }

    return null;
  }
}
