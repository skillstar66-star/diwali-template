const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'rokeya-3ccaa';

// Helper to unwrap Firestore REST API data types
function unwrapFirestoreData(fields) {
  if (!fields) return {};
  const data = {};
  for (const key in fields) {
    const val = fields[key];
    if (val.stringValue !== undefined) data[key] = val.stringValue;
    else if (val.integerValue !== undefined) data[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) data[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) data[key] = val.booleanValue;
    else if (val.arrayValue !== undefined) {
      data[key] = val.arrayValue.values ? val.arrayValue.values.map(v => v.stringValue || v.integerValue || v.doubleValue) : [];
    } else if (val.mapValue !== undefined) {
      data[key] = unwrapFirestoreData(val.mapValue.fields);
    }
  }
  return data;
}

// Fetch from Firestore
async function getProductBySlugOrId(slug) {
  // First try to query by slug
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'products' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'slug' },
          op: 'EQUAL',
          value: { stringValue: slug }
        }
      },
      limit: 1
    }
  };

  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
      method: 'POST',
      body: JSON.stringify(query),
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();
    if (result && result.length > 0 && result[0].document) {
      const doc = result[0].document;
      const data = unwrapFirestoreData(doc.fields);
      data.id = doc.name.split('/').pop();
      return data;
    }

    // Fallback: try by aliases array contains slug
    const aliasQuery = {
      structuredQuery: {
        from: [{ collectionId: 'products' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'aliases' },
            op: 'ARRAY_CONTAINS',
            value: { stringValue: slug }
          }
        },
        limit: 1
      }
    };
    const aliasRes = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
      method: 'POST',
      body: JSON.stringify(aliasQuery),
      headers: { 'Content-Type': 'application/json' }
    });
    const aliasResult = await aliasRes.json();
    if (aliasResult && aliasResult.length > 0 && aliasResult[0].document) {
      const doc = aliasResult[0].document;
      const data = unwrapFirestoreData(doc.fields);
      data.id = doc.name.split('/').pop();
      return data;
    }

    // Fallback: try by document ID
    const docRes = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products/${slug}`);
    if (docRes.ok) {
      const doc = await docRes.json();
      const data = unwrapFirestoreData(doc.fields);
      data.id = doc.name.split('/').pop();
      return data;
    }
  } catch (error) {
    console.error('Firestore fetch error:', error);
  }
  return null;
}


// ── PRODUCT CARE ENGINE ───────────────────────────────────────────────
function escapeHtmlCare(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getCareSummary(careText, category) {
  if (!careText) return 'Dry Wash Only';
  const lines = String(careText).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const washRegex = /(wash|clean|dry\s*clean|wipe)/i;

  for (const line of lines) {
    const stripped = line.replace(/^[✦•\-\*•●\s]+/, '').replace(/^\d+[\.\)\-:]\s*/, '').trim();
    if (/^(care|product\s*care|product\s*details|instructions?)/i.test(stripped)) continue;
    if (washRegex.test(stripped)) {
      let val = stripped;
      if (stripped.includes(':')) {
        val = stripped.split(':').slice(1).join(':').trim();
      }
      const clause = val.split(/[.;—]/)[0].trim();
      if (clause.length > 0 && clause.length <= 40) return clause;
      if (clause.length > 40) return clause.slice(0, 37) + '...';
    }
  }

  for (const line of lines) {
    const stripped = line.replace(/^[✦•\-\*•●\s]+/, '').replace(/^\d+[\.\)\-:]\s*/, '').trim();
    if (/^(care|product\s*care|product\s*details|instructions?)/i.test(stripped)) continue;
    let val = stripped.includes(':') ? stripped.split(':').slice(1).join(':').trim() : stripped;
    const clause = val.split(/[.;—]/)[0].trim();
    if (clause.length > 0 && clause.length <= 40) return clause;
    if (clause.length > 40) return clause.slice(0, 37) + '...';
  }

  return 'Dry Wash Only';
}

function getCareIconSvg(title, descText) {
  const t = (title || '').toLowerCase();
  const d = (descText || '').toLowerCase();

  // 1. Water / Moisture
  if (t.includes('water') || t.includes('moist') || t.includes('humid') || d.includes('moisture') || d.includes('humidity')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
  }
  // 2. Wash / Soak
  if (t.includes('wash') || t.includes('soak') || d.includes('wash') || d.includes('soak')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M2 12h20"/><path d="M20 12v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-4"/><path d="M4 12V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6"/><path d="M9 15v2M12 14v3M15 15v2"/></svg>`;
  }
  // 3. Dry Clean / Sparkle / Cleaning
  if (t.includes('clean') || t.includes('wipe') || t.includes('polish') || d.includes('dry clean') || d.includes('cleaning') || d.includes('wipe')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`;
  }
  // 4. Iron / Press
  if (t.includes('iron') || t.includes('press') || t.includes('steam') || d.includes('iron') || d.includes('press')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M4 18h16a1 1 0 0 0 1-1c0-4-3-7-7-7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1z"/><path d="M6 10V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></svg>`;
  }
  // 5. Drying / Sunlight / Shade
  if (t.includes('dry') || t.includes('shade') || t.includes('sun') || d.includes('shade') || d.includes('sunlight') || d.includes('air dry') || d.includes('tumble dry')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
  }
  // 6. Storage / Muslin / Box
  if (t.includes('stor') || t.includes('muslin') || t.includes('pouch') || t.includes('box') || t.includes('fold') || d.includes('muslin') || d.includes('store') || d.includes('pouch')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`;
  }
  // 7. Perfume / Chemicals / Spray
  if (t.includes('perfume') || t.includes('chemical') || t.includes('spray') || t.includes('lotion') || d.includes('perfume') || d.includes('chemical') || d.includes('hairspray')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M10 2v4M14 2v4M6 10v10a2 2 0 002 2h8a2 2 0 002-2V10a2 2 0 00-2-2H8a2 2 0 00-2 2z"/></svg>`;
  }
  // 8. Bleach / Harsh Detergents
  if (t.includes('bleach') || t.includes('harsh') || d.includes('bleach') || d.includes('harsh detergent')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }
  // 9. Colour / Bleed / Dye
  if (t.includes('colour') || t.includes('color') || t.includes('bleed') || t.includes('fade') || d.includes('bleed') || d.includes('color fading') || d.includes('colour fading')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`;
  }
  // 10. Material / Fabric / Silk / Zari / Organza / Saree Type
  if (t.includes('material') || t.includes('fabric') || t.includes('silk') || t.includes('zari') || t.includes('organza') || t.includes('type') || t.includes('border') || t.includes('design')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M2 9h20M2 15h20M9 2v20M15 2v20"/></svg>`;
  }
  // 11. Shipment / Dispatch
  if (t.includes('ship') || t.includes('dispatch') || t.includes('deliver') || d.includes('dispatch') || d.includes('shipment')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`;
  }
  // 12. Delicate Handling / Wring / Scrub / Stone
  if (t.includes('handl') || t.includes('wring') || t.includes('delicate') || t.includes('scrub') || t.includes('stone') || d.includes('wring') || d.includes('scrub') || d.includes('scratch')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  }

  // 13. Default
  return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold, #c9a84c)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
}

function generateProductCareData(p) {
  const isJewellery = (p && ((p.category && p.category.toLowerCase().includes('jewel')) || (p.name && /necklace|haaram|bangle|earring|choker|tikka|jewel/i.test(p.name))));
  let rawText = (p && p.productCare) ? String(p.productCare).trim() : '';

  if (!rawText) {
    rawText = isJewellery
      ? 'CARE & SAFETY\n✦ Cleaning: Wipe gently with a soft cloth after each use.\n✦ Moisture: Keep away from water, perfumes, lotions, and sprays.\n✦ Storage: Store in a zip-lock pouch or airtight box with cotton or tissue.\n✦ Handling: Avoid dropping or bending delicate handcrafted components.\n✦ Longevity: Put on jewellery last when dressing and take off first.'
      : 'Care & Storage Instructions\nWash: Professional dry clean recommended to preserve fabric structure and zari.\nDrying: Always dry in shade away from direct sunlight. Never tumble dry.\nIroning: Iron on low or silk heat setting with a protective cloth on the reverse side.\nStorage: Fold neatly and wrap in breathable muslin or cotton cloth.\nHandling: Avoid harsh scrubbing or direct contact with perfumes and moisture.';
  }

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let headerTitle = 'Product Care Essentials';
  const headerRegex = /^(care(\s*(&|and)\s*(storage|safety))?(\s*instructions?)?|product\s*care(\s*instructions?)?|care\s*instructions?|product\s*details|instructions?)$/i;

  let itemsToProcess = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/^[✦•\-\*•●\s]+/, '').replace(/[:\s]+$/, '').trim();
    if (i === 0 && headerRegex.test(stripped)) {
      headerTitle = stripped;
      continue;
    }
    if (headerRegex.test(stripped)) continue;
    itemsToProcess.push(line);
  }

  if (itemsToProcess.length === 1 && !itemsToProcess[0].includes(':')) {
    const single = itemsToProcess[0];
    const splitSentences = single.split(/(?<=[.!?])\s+(?=[A-Z0-9✦•\-\*])/).map(s => s.trim()).filter(Boolean);
    if (splitSentences.length > 1) {
      itemsToProcess = splitSentences;
    }
  }

  let cardsHtml = '';
  itemsToProcess.forEach(item => {
    let clean = item.replace(/^[✦•\-\*•●]\s*/, '').replace(/^\d+[\.\)\-:]\s*/, '').trim();
    if (!clean) return;

    let title = 'Care Tip';
    let descText = clean;

    const colonIdx = clean.indexOf(':');
    if (colonIdx > 0 && colonIdx <= 35) {
      title = clean.substring(0, colonIdx).trim();
      descText = clean.substring(colonIdx + 1).trim();
      if (!descText) {
        descText = title;
        title = 'Care Tip';
      }
    } else {
      const lower = clean.toLowerCase();
      if (lower.includes('dry clean')) title = 'Dry Clean';
      else if (lower.includes('machine wash')) title = 'Machine Wash';
      else if (lower.includes('hand wash')) title = 'Hand Wash';
      else if (lower.includes('wash') || lower.includes('soak')) title = 'Wash Care';
      else if (lower.includes('iron') || lower.includes('press') || lower.includes('steam')) title = 'Ironing';
      else if (lower.includes('sun') || lower.includes('shade') || lower.includes('drying') || lower.includes('dry')) title = 'Drying';
      else if (lower.includes('stor') || lower.includes('muslin') || lower.includes('pouch') || lower.includes('box') || lower.includes('fold')) title = 'Storage';
      else if (lower.includes('water') || lower.includes('moisture') || lower.includes('humidity')) title = 'Moisture Care';
      else if (lower.includes('perfume') || lower.includes('chemical') || lower.includes('spray') || lower.includes('lotion')) title = 'Protection';
      else if (lower.includes('bleach') || lower.includes('harsh')) title = 'Detergent & Bleach';
      else if (lower.includes('colour') || lower.includes('color') || lower.includes('bleed') || lower.includes('fade')) title = 'Colour Care';
      else if (lower.includes('handl') || lower.includes('wring') || lower.includes('delicate') || lower.includes('scrub')) title = 'Delicate Handling';
      else if (lower.includes('longevity') || lower.includes('maintain') || lower.includes('polish')) title = 'Longevity Tip';
    }

    const iconSvg = getCareIconSvg(title, descText);

    cardsHtml += `
      <div class="care-card-item">
        <div class="care-card-header">
          <div class="care-card-icon">
             ${iconSvg}
          </div>
          <div class="care-card-title">${escapeHtmlCare(title)}</div>
        </div>
        <div class="care-card-desc">${escapeHtmlCare(descText)}</div>
      </div>
    `;
  });

  const html = `<div class="care-grid">${cardsHtml}</div>`;
  return { headerTitle, html };
}
// ─────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  const { slug } = req.query;
  
  if (!slug) {
    return res.redirect(302, '/collections');
  }

  // Reject static files / extension requests misrouted to /api/product
  if (slug.includes('.')) {
    return res.status(404).send('Not found');
  }

  const p = await getProductBySlugOrId(slug);
  
  // Load raw HTML
  let html = '';
  try {
    const htmlPath = path.join(process.cwd(), 'product-details.html');
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (err) {
    return res.status(500).send('HTML template not found.');
  }

  if (!html.includes('<base href="/">')) {
    html = html.replace('<head>', '<head>\n    <base href="/">');
  }
  html = html.replace(/href="\.\/style\.css"/g, 'href="/style.css"');
  html = html.replace(/href="\.\/mobile\.css"/g, 'href="/mobile.css"');
  html = html.replace(/src="\.\/config\.js"/g, 'src="/config.js"');
  html = html.replace(/src="\.\/script\.js"/g, 'src="/script.js"');

  if (!p) {
    // Product not found, fallback to serving default HTML (or redirect)
    return res.status(404).send(html.replace('<title>Product Details', '<title>Product Not Found'));
  }

  // --- Prepare SEO Data ---
  const productPrice = parseFloat(p.price) || 0; 
  const productImg = p.image || p.img || '';
  const productDesc = (p.description || '').split('\n')[0].replace(/^[✦•\-\*]\s*/, '').trim() || 'Luxury handwoven saree from ROKEA by RK, Coimbatore.';
  const productName = p.name || p.slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const productUrl = `https://rokeabyrk.com/product/${p.slug || p.id}`;
  
  const cleanPrice = parseFloat(productPrice.toString().replace(/[^0-9.]/g, '')) || 0;

  // Create valid JSON-LD
  const productSchemaData = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": productName,
    "description": productDesc || productName,
    "brand": { "@type": "Brand", "name": "ROKEA by RK" },
    "category": p.category || "",
    "sku": p.id || p.slug,
    "url": productUrl,
    "offers": {
      "@type": "Offer",
      "priceCurrency": "INR",
      "price": cleanPrice,
      "url": productUrl,
      "availability": p.stock === 'Out of Stock' ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition",
      "seller": { "@type": "Organization", "name": "ROKEA by RK" }
    }
  };
  
  if (productImg) {
    productSchemaData.image = [productImg];
  }

  // --- Inject into HTML string ---
  
  // --- Inject into HTML string ---
  
  const finalTitle = p.seoTitle || `${productName} | ${p.category || 'Luxury Saree'} — ROKEA by RK`;
  const finalDesc = p.seoDesc || `${productDesc.slice(0, 140)} | Buy ${productName} at ROKEA by RK, Coimbatore.`;
  const finalCanonical = p.seoCanonical || productUrl;
  
  // 1. Replace Title
  html = html.replace(/<title>.*?<\/title>/, `<title>${finalTitle}</title>`);
  
  // 3. Replace/Inject Meta Description, Keywords, Robots
  let metaTags = `<meta name="description" content="${finalDesc}">`;
  if (p.seoKeywords) metaTags += `\n<meta name="keywords" content="${p.seoKeywords}">`;
  if (p.seoRobots) metaTags += `\n<meta name="robots" content="${p.seoRobots}">`;
  
  if (html.includes('<meta name="description"')) {
    html = html.replace(/<meta name="description".*?>/, metaTags);
  } else {
    html = html.replace('</head>', `${metaTags}\n</head>`);
  }

  // 4. Replace OG Tags
  if(p.seoOgTags) {
     html = html.replace(/<meta property="og:.*?".*?>/g, ''); 
     html = html.replace('</head>', `${p.seoOgTags}\n</head>`);
  } else {
    html = html.replace(/<meta property="og:title" id="ogTitle" content=".*?"/g, `<meta property="og:title" id="ogTitle" content="${finalTitle}"`);
    html = html.replace(/<meta property="og:description" id="ogDesc" content=".*?"/g, `<meta property="og:description" id="ogDesc" content="${finalDesc}"`);
    html = html.replace(/<meta property="og:image" id="ogImage" content=".*?"/g, `<meta property="og:image" id="ogImage" content="${productImg}"`);
    html = html.replace(/<meta property="og:url" id="ogUrl" content=".*?"/g, `<meta property="og:url" id="ogUrl" content="${finalCanonical}"`);
  }

  // 5. Replace Twitter Tags
  if(p.seoTwitterTags) {
     html = html.replace(/<meta name="twitter:.*?".*?>/g, '');
     html = html.replace('</head>', `${p.seoTwitterTags}\n</head>`);
  } else {
    html = html.replace(/<meta name="twitter:title" id="twTitle" content=".*?"/g, `<meta name="twitter:title" id="twTitle" content="${finalTitle}"`);
    html = html.replace(/<meta name="twitter:description" id="twDesc" content=".*?"/g, `<meta name="twitter:description" id="twDesc" content="${finalDesc}"`);
    html = html.replace(/<meta name="twitter:image" id="twImage" content=".*?"/g, `<meta name="twitter:image" id="twImage" content="${productImg}"`);
  }

  // 6. Replace Canonical
  html = html.replace(/<link id="canonicalUrl" rel="canonical" href=".*?"/, `<link id="canonicalUrl" rel="canonical" href="${finalCanonical}"`);

  // 7. Inject JSON-LD Schemas
  let schemaString = '';
  if (p.seoProductSchema) {
    schemaString += `<script type="application/ld+json" id="productSchema">\n${p.seoProductSchema}\n</script>`;
  } else {
    schemaString += `<script type="application/ld+json" id="productSchema">\n${JSON.stringify(productSchemaData)}\n</script>`;
  }
  
  if (p.seoBreadcrumbSchema) {
    schemaString += `\n<script type="application/ld+json" id="breadcrumbSchema">\n${p.seoBreadcrumbSchema}\n</script>`;
  }
  if (p.seoWebPageSchema) {
    schemaString += `\n<script type="application/ld+json" id="webPageSchema">\n${p.seoWebPageSchema}\n</script>`;
  }
  if (p.seoOrganizationSchema) {
    schemaString += `\n<script type="application/ld+json" id="organizationSchema">\n${p.seoOrganizationSchema}\n</script>`;
  }
  if (p.seoFaq) {
    // Convert parsed FAQ array into FAQPage schema
    try {
      const faqs = typeof p.seoFaq === 'string' ? JSON.parse(p.seoFaq) : p.seoFaq;
      if (Array.isArray(faqs) && faqs.length > 0) {
        const faqSchema = {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "mainEntity": faqs.map(f => ({
            "@type": "Question",
            "name": f.question,
            "acceptedAnswer": {
              "@type": "Answer",
              "text": f.answer
            }
          }))
        };
        schemaString += `\n<script type="application/ld+json" id="faqSchema">\n${JSON.stringify(faqSchema)}\n</script>`;
      }
    } catch(e) {}
  }

  if (html.includes('<script type="application/ld+json" id="productSchema"></script>')) {
    html = html.replace('<script type="application/ld+json" id="productSchema"></script>', schemaString);
  } else {
    html = html.replace('</head>', `${schemaString}\n</head>`);
  }

  // 7. Inject SSR global variable for client-side script to skip Firestore fetch
  const ssrState = `<script>window.__INITIAL_PRODUCT_DATA__ = ${JSON.stringify(p)};</script>`;
  html = html.replace('</head>', `${ssrState}\n</head>`);

  // 8. Pre-render visible product fields into the HTML for instant SSR display
  html = html.replace(/<h1 class="product-title-big" id="detailName">.*?<\/h1>/, `<h1 class="product-title-big" id="detailName" style="display:block;">${productName}</h1>`);
  html = html.replace(/<div class="product-price-big" id="detailPrice">.*?<\/div>/, `<div class="product-price-big" id="detailPrice">₹${cleanPrice.toLocaleString('en-IN')}</div>`);
  html = html.replace(/<span id="breadcrumb-name">.*?<\/span>/, `<span id="breadcrumb-name">${productName}</span>`);
  if (p.category) {
    html = html.replace(/<a href="collections\.html" id="breadcrumb-cat">.*?<\/a>/, `<a href="/collections" id="breadcrumb-cat">${p.category}</a>`);
  }
  if (productImg) {
    html = html.replace(/<div class="img-skeleton" id="imgSkeleton">/g, '<div class="img-skeleton hide" id="imgSkeleton" style="display:none;">');
    html = html.replace(/id="detailMainImg"/, `id="detailMainImg" src="${productImg}" class="img-loaded"`);
  }
  if (p.description) {
    const formattedDesc = p.description.trim().replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
    html = html.replace(/<div id="descBody">[\s\S]*?<\/div>/, `<div id="descBody"><div class="info-box"><div class="info-box-title">Product Description</div><div class="info-box-text">${formattedDesc}</div></div></div>`);
  }

  // Pre-render Care section into SSR HTML
  const careResult = generateProductCareData(p);
  if (careResult && careResult.html) {
    html = html.replace(/<div id="careBody">[\s\S]*?<\/div>/, `<div id="careBody">${careResult.html}</div>`);
    if (careResult.headerTitle) {
      html = html.replace(/<div class="info-box-title" id="careBoxTitle">.*?<\/div>/, `<div class="info-box-title" id="careBoxTitle">${careResult.headerTitle}</div>`);
      html = html.replace(/<div class="info-box-title">Product Care Essentials<\/div>/, `<div class="info-box-title" id="careBoxTitle">${careResult.headerTitle}</div>`);
    }
  }

  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate'); // Cache at Edge
  return res.status(200).send(html);
}
