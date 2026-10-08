import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import { generateFacturX } from '@stackforge-eu/factur-x';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { htmlLayout, rawInvoiceData } = req.body;
    const remotePackUrl = "https://github.com";

    // 1. Launch Serverless Chromium
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(remotePackUrl),
      headless: chromium.headless,
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlLayout, { waitUntil: 'networkidle0' });
    const standardPdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    // 2. Compile into a verified European Factur-X PDF/A-3 container
    const compliantPdfBuffer = await generateFacturX({
      pdf: standardPdfBuffer,
      profile: 'EN16931', 
      invoice: {
        id: rawInvoiceData.id,
        issueDate: rawInvoiceData.date,
        currency: rawInvoiceData.currency || 'EUR',
        seller: {
          name: rawInvoiceData.sellerName,
          vatId: rawInvoiceData.sellerVat,
          registrationId: rawInvoiceData.sellerSiret
        },
        buyer: {
          name: rawInvoiceData.buyerName,
          vatId: rawInvoiceData.buyerVat
        },
        lines: rawInvoiceData.items.map(item => ({
          name: item.description,
          quantity: item.qty,
          price: item.unitPrice,
          vatRate: item.vatPercentage
        }))
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${rawInvoiceData.id}.pdf`);
    return res.send(compliantPdfBuffer);

  } catch (error) {
    console.error('Factur-X Serverless Pipeline Failure:', error);
    return res.status(500).send('Compliance Compilation Failed');
  }
}
