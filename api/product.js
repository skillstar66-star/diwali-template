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
    const formattedDesc = p.description.split('\n').filter(l => l.trim()).map(l => l.replace(/^[✦•\-\*]\s*/, '').trim()).join('<br><br>');
    html = html.replace(/<div id="descBody">[\s\S]*?<\/div>/, `<div id="descBody"><div class="info-box"><div class="info-box-title">Product Description</div><div class="info-box-text">${formattedDesc}</div></div></div>`);
  }

  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate'); // Cache at Edge
  return res.status(200).send(html);
}
