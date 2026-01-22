import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx';
import puppeteer from 'puppeteer';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';

export class DocumentService {
  /**
   * Generate DOCX from structured data
   */
  async generateDocxFromStructured(data: any): Promise<Buffer> {
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
            children: this.buildDocxContent(data),
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
   * Generate DOCX from plain text
   */
  async generateDocxFromText(text: string): Promise<Buffer> {
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
              borders: {
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
  async generatePdfFromStructured(data: any): Promise<Buffer> {
    try {
      const html = this.buildResumeHtml(data);
      return this.generatePdfFromHtml(html);
    } catch (error: any) {
      logger.error('PDF generation from structured error:', error);
      throw new Error('Failed to generate PDF: ' + error.message);
    }
  }

  /**
   * Generate PDF from plain text
   */
  async generatePdfFromText(text: string): Promise<Buffer> {
    try {
      const html = this.buildHtmlFromText(text);
      return this.generatePdfFromHtml(html);
    } catch (error: any) {
      logger.error('PDF generation from text error:', error);
      throw new Error('Failed to generate PDF: ' + error.message);
    }
  }

  private async generatePdfFromHtml(html: string): Promise<Buffer> {
    try {
      // Try to find Chrome/Chromium executable
      const executablePath = await this.findChromeExecutable();
      
      const launchOptions: any = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      };

      if (executablePath) {
        launchOptions.executablePath = executablePath;
        logger.info('Using Chrome executable:', executablePath);
      } else {
        logger.warn('No Chrome executable found, trying default Puppeteer browser');
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

        return Buffer.from(pdf);
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

  private buildDocxContent(data: any): Paragraph[] {
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
          borders: {
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
          borders: {
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
          borders: {
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
          borders: {
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

  private buildResumeHtml(data: any): string {
    // Build HTML from structured data - matching Laravel implementation
    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 40px;
            color: #000000;
            line-height: 1.6;
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

  private buildHtmlFromText(text: string): string {
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

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 40px;
            color: #000000;
            line-height: 1.6;
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
    </style>
</head>
<body>
${htmlParts.join('\n')}
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
