import * as fs from "fs";
import * as cheerio from "cheerio";
import chalk from 'chalk';
import path from 'path';

function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')        // Replace multiple spaces/newlines with single space
    .replace(/^\s+|\s+$/g, '')   // Trim whitespace
    .replace(/\u00A0/g, ' ');    // Replace non-breaking spaces with regular spaces
}

async function scrapeArticlesFromPage(url) {
  const response = await fetch(url, {
    headers: {
      'Cookie': 'DSGVO_ZUSAGE_V1=true; tcfs=1'
    }
  });
  const html = await response.text();

  const $ = cheerio.load(html);

  const articles = [];
  $('article[data-type="story"]').each((i, element) => {
    const articleEl = $(element);
    const link = articleEl.find('a').attr('href');
    const title = articleEl.find('.teaser-title').text().trim();

    const dateSection = articleEl.closest('section[data-type="date"]');
    const dateText = dateSection.find('time').attr('datetime');
    const date = dateText ? new Date(dateText) : null;

    const imageEl = articleEl.find('img');
    const imageUrl = imageEl.attr('src') || imageEl.attr('data-src');

    articles.push({
      title,
      date,
      link: `https://www.derstandard.at${link}`,
      image: imageUrl
    });
  });

  const nextPageEl = $('.overview-readmore a');
  const nextPageLink = nextPageEl.length ?
    `https://www.derstandard.at${nextPageEl.attr('href')}` :
    null;

  return {
    articles,
    nextPageLink
  };
}

async function getAllArticles(startUrl) {
  let currentUrl = startUrl;
  let allArticles = [];
  let pageCount = 0;

  while (currentUrl) {
    pageCount++;
    console.log(chalk.blue(`Fetching page ${pageCount}: ${currentUrl}`));
    const { articles, nextPageLink } = await scrapeArticlesFromPage(currentUrl);
    console.log(chalk.green(`  ✓ Found ${articles.length} articles`));
    allArticles = [...allArticles, ...articles];

    await new Promise(resolve => setTimeout(resolve, 1000));

    currentUrl = nextPageLink;
  }

  return allArticles;
}

async function scrapeArticlePage(url) {
  console.log(chalk.blue(`  Fetching article: ${url}`));

  const response = await fetch(url, {
    headers: {
      'Cookie': 'DSGVO_ZUSAGE_V1=true; tcfs=1'
    }
  });
  const html = await response.text();
  const $ = cheerio.load(html);

  // Get teaser content
  const summary = $('meta[name="description"]').attr('content') || '';
  const introText = $('.story-lead').text();
  const teaser = [summary, introText].filter(Boolean).join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  // Get author if available
  const author = $('.article-author').text().trim();

  // Extract content in order of appearance
  const content = [];
  $('.article-body').children().each((_, element) => {
    const el = $(element);

    // Handle images (both old and new formats)
    if (el.is('figure') || el.find('img').length) {
      el.find('img').each((_, img) => {
        const $img = $(img);
        const src = $img.attr('data-fullscreen-src') ||
                   $img.attr('src') ||
                   $img.attr('data-src');

        // Get caption only from figcaption
        let caption = '';
        const figure = $img.closest('figure');
        if (figure.length) {
          caption = figure.find('figcaption').text().trim();
        }

        if (src) {
          content.push({
            type: 'image',
            src: src,
            caption: caption
          });
        }
      });
      return; // Skip processing this element as HTML content
    }

    // Handle text content (paragraphs, links, etc.)
    const html = el.html();
    if (html && !el.is('figure')) { // Skip figure elements as we already handled images
      content.push({
        type: 'html',
        content: cleanText(html)
      });
    }
  });

  // Get all images using the original logic for backwards compatibility
  const images = [];
  $('.article-body img').each((_, img) => {
    const $img = $(img);
    const src = $img.attr('data-fullscreen-src') ||
                $img.attr('src') ||
                $img.attr('data-src');
    if (src && !images.includes(src)) {
      images.push(src);
    }
  });

  return {
    images,          // Original images array with unique images
    content,         // New field containing ordered content
    text: $('.article-body').html() || '', // Keep for backwards compatibility
    teaser,
    author: author || null
  };
}

async function updateArticlesWithDetails(forceReExtract = false) {
  if (!fs.existsSync('articles.json')) {
    console.log(chalk.red('articles.json not found. Please run article scraping first.'));
    process.exit(1);
  }

  const articles = JSON.parse(fs.readFileSync('articles.json', 'utf-8'));
  let remainingCount = articles.length;
  console.log(chalk.yellow(`Found ${articles.length} articles to process`));

  let updatedCount = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    remainingCount--;

    if (!forceReExtract && typeof article.text === 'string' && typeof article.teaser === 'string') {
      console.log(chalk.gray(`  Skipping ${article.title} (already processed)`));
      continue;
    }

    try {
      const { images, text, teaser, author, content } = await scrapeArticlePage(article.link);

      articles[i] = {
        ...article,
        images,
        text,
        teaser,
        author,
        content
      };

      console.log(chalk.green(`  ✓ Updated article: ${article.title}`));
      console.log(chalk.gray(`    Found ${images.length} images`));
      console.log(chalk.yellow(`    ${remainingCount} articles remaining`));
      updatedCount++;

      fs.writeFileSync('articles.tmp.json', JSON.stringify(articles, null, 2));

      await new Promise(resolve => setTimeout(resolve, 250));
    } catch (error) {
      console.log(chalk.red(`  ✗ Error processing ${article.title}:`), error);
      console.log(chalk.yellow(`    ${remainingCount} articles remaining`));
      fs.writeFileSync('articles.tmp.json', JSON.stringify(articles, null, 2));
    }
  }

  if (updatedCount > 0) {
    fs.renameSync('articles.tmp.json', 'articles.json');
    console.log(chalk.green.bold(`✨ Done! Updated ${updatedCount} articles`));
  } else {
    console.log(chalk.green.bold(`✨ Done! No articles needed updating`));
  }
}

async function downloadImage(url, targetPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const buffer = await response.arrayBuffer();
      const tmpPath = `${targetPath}.tmp`;

      await fs.promises.writeFile(tmpPath, Buffer.from(buffer));
      fs.renameSync(tmpPath, targetPath);

      return true;
    } catch (error) {
      if (attempt === retries) {
        console.log(chalk.red(`Failed to download ${url} after ${retries} attempts:`), error);
        return false;
      }
      // Exponential backoff: 2s, 4s, 8s between retries
      await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt - 1)));
    }
  }
}

async function downloadAllImages() {
  const articles = JSON.parse(fs.readFileSync('articles.json', 'utf-8'));

  // Create output/images directory
  if (!fs.existsSync('output/images')) {
    fs.mkdirSync('output/images', { recursive: true });
  }

  // Create a queue of all images to download
  const downloadQueue = [];

  for (const article of articles) {
    if (!article.images || article.images.length === 0) continue;

    const dateStr = new Date(article.date).toISOString().split('T')[0];

    // Ensure date directory exists
    if (!fs.existsSync(`output/images/${dateStr}`)) {
      fs.mkdirSync(`output/images/${dateStr}`, { recursive: true });
    }

    // Add each image to the queue
    for (const imageUrl of article.images) {
      const targetPath = `output/images/${dateStr}/${imageUrl.split('/').pop().split('?')[0]}`;

      if (fs.existsSync(targetPath)) {
        console.log(chalk.gray(`  Skipping ${imageUrl} (already exists)`));
        continue;
      }

      downloadQueue.push({ imageUrl, targetPath });
    }
  }

  // Process queue with 5 concurrent downloads
  const concurrentDownloads = 5;
  const totalImages = downloadQueue.length;
  let completedDownloads = 0;

  while (downloadQueue.length > 0) {
    const batch = downloadQueue.splice(0, concurrentDownloads);
    const downloads = batch.map(async ({ imageUrl, targetPath }) => {
      console.log(chalk.yellow(`  Downloading ${imageUrl}...`));
      await downloadImage(imageUrl, targetPath);
      completedDownloads++;
      console.log(chalk.gray(`    Progress: ${completedDownloads}/${totalImages}`));
    });

    await Promise.all(downloads);

    // Small delay between batches to be gentle on the server
    if (downloadQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

function generateArticleHtml(article, index) {
  const dateStr = new Date(article.date).toISOString().split('T')[0];

  // Get all image data for lightbox navigation
  const imageData = article.content ?
    article.content
      .filter(item => item.type === 'image')
      .map(item => {
        const filename = item.src.split('/').pop().split('?')[0];
        return {
          src: `images/${dateStr}/${filename}`,
          caption: item.caption || ''
        };
      }) : [];

  return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${article.title}</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
        }

        .container {
            padding: 1rem;
            margin: 0 auto;
            max-width: 100%;
            box-sizing: border-box;
        }

        .article {
            margin: 0 auto;
        }

        .article h1 {
            font-size: 2em;
            margin: 0.5em 0;
            line-height: 1.2;
        }

        .article-meta {
            color: #666;
            margin-bottom: 2em;
        }

        .article-teaser {
            font-size: 1.2em;
            color: #444;
            margin-bottom: 2em;
        }

        .image-container {
            margin: 2em 0;
        }

        .image-caption {
            font-size: 0.9em;
            color: #666;
            margin: 0.5em 0 1.5em;
            font-style: italic;
        }

        .article-content img {
            max-width: 100%;
            height: auto;
            display: block;
        }

        .article-footer {
            margin-top: 3em;
            padding-top: 1em;
            border-top: 1px solid #eee;
        }

        .article-footer a {
            color: #666;
            text-decoration: none;
        }

        .article-footer a:hover {
            color: #333;
        }

        /* Desktop styles */
        @media (min-width: 768px) {
            .container {
                max-width: 800px;
                padding: 2rem;
            }

            .article-content img {
                max-width: 100%;
                margin: 0 auto;
            }

            .image-container {
                margin: 3em auto;
            }

            h1 {
                font-size: 2.5em;
            }
        }

        /* Large desktop styles */
        @media (min-width: 1200px) {
            .container {
                max-width: 1000px;
            }
        }

        /* Lightbox styles */
        .lightbox {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            z-index: 1000;
        }

        .lightbox.active {
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .lightbox img {
            max-width: 90%;
            max-height: 90vh;
            object-fit: contain;
        }

        .article-content img {
            cursor: pointer;
        }

        /* Navigation buttons */
        .lightbox-nav {
            position: fixed;
            top: 50%;
            transform: translateY(-50%);
            color: #fff;
            font-size: 40px;
            cursor: pointer;
            width: 60px;
            height: 60px;
            line-height: 60px;
            text-align: center;
            background: rgba(0, 0, 0, 0.5);
            border-radius: 50%;
            user-select: none;
            z-index: 1001;
        }

        .lightbox-prev {
            left: 20px;
        }

        .lightbox-next {
            right: 20px;
        }

        /* Close button */
        .lightbox-close {
            position: fixed;
            top: 20px;
            right: 20px;
            color: #fff;
            font-size: 30px;
            cursor: pointer;
            z-index: 1001;
            width: 40px;
            height: 40px;
            line-height: 40px;
            text-align: center;
            background: rgba(0, 0, 0, 0.5);
            border-radius: 50%;
        }

        .lightbox-caption {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            color: #fff;
            text-align: center;
            padding: 15px;
            font-style: italic;
            background: rgba(0, 0, 0, 0.5);
            margin: 0;
        }

        header {
            text-align: center;
            margin-bottom: 2em;
            padding: 1em 0;
            border-bottom: 1px solid #eee;
        }

        header h1 {
            font-size: 2em;
            margin: 0;
            font-weight: 700;
            letter-spacing: -0.02em;
        }

        header a {
            color: inherit;
            text-decoration: none;
        }

        header a:hover {
            color: #000;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1><a href="archive.html">CEMERS PHOTOBLOG</a></h1>
        </header>

        <article class="article">
            <h1>${article.title}</h1>
            <div class="article-meta">
                ${new Date(article.date).toLocaleDateString('de-DE')}
                ${article.author ? `• ${article.author}` : ''}
            </div>

            <div class="article-teaser">
                ${article.teaser}
            </div>

            <div class="article-content">
                ${article.content ?
                  article.content.map((item, idx) => {
                    if (item.type === 'image') {
                      const filename = item.src.split('/').pop().split('?')[0];
                      return `
                        <div class="image-container">
                          ${item.caption ? `<div class="image-caption">${item.caption}</div>` : ''}
                          <img src="images/${dateStr}/${filename}"
                               alt="${item.caption || ''}"
                               data-index="${idx}"
                               onclick="openLightbox(this)">
                        </div>`;
                    } else {
                      return item.content;
                    }
                  }).join('\n')
                  :
                  article.text
                }
            </div>

            <div class="article-footer">
                <a href="archive.html">← Zurück zur Übersicht</a>
            </div>
        </article>
    </div>

    <!-- Lightbox -->
    <div class="lightbox">
        <div class="lightbox-close" onclick="closeLightbox()">×</div>
        <div class="lightbox-nav lightbox-prev" onclick="navigateImage(-1)">‹</div>
        <div class="lightbox-nav lightbox-next" onclick="navigateImage(1)">›</div>
        <img src="" alt="" onclick="event.stopPropagation()">
        <div class="lightbox-caption"></div>
    </div>

    <script>
        // Store image data for navigation
        const images = ${JSON.stringify(imageData)};
        let currentImageIndex = 0;

        function openLightbox(img) {
            currentImageIndex = parseInt(img.dataset.index);
            showCurrentImage();
            document.querySelector('.lightbox').classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function showCurrentImage() {
            const lightbox = document.querySelector('.lightbox');
            const lightboxImg = lightbox.querySelector('img');
            const caption = lightbox.querySelector('.lightbox-caption');

            lightboxImg.src = images[currentImageIndex].src;
            lightboxImg.alt = images[currentImageIndex].caption;
            caption.textContent = images[currentImageIndex].caption;
        }

        function navigateImage(direction) {
            currentImageIndex = (currentImageIndex + direction + images.length) % images.length;
            showCurrentImage();
            event.stopPropagation();
        }

        function closeLightbox() {
            document.querySelector('.lightbox').classList.remove('active');
            document.body.style.overflow = '';
        }

        // Keyboard navigation
        document.addEventListener('keydown', function(e) {
            if (!document.querySelector('.lightbox.active')) return;

            switch(e.key) {
                case 'ArrowLeft':
                    navigateImage(-1);
                    break;
                case 'ArrowRight':
                    navigateImage(1);
                    break;
                case 'Escape':
                    closeLightbox();
                    break;
            }
        });

        // Close lightbox when clicking the background
        document.querySelector('.lightbox').addEventListener('click', function(e) {
            if (e.target === this) {
                closeLightbox();
            }
        });
    </script>
</body>
</html>`;
}

function generateHtml() {
  const articles = JSON.parse(fs.readFileSync('articles.json', 'utf-8'));
  articles.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Get date range for the inputs
  const dates = articles.map(a => new Date(a.date));
  const minDate = dates.reduce((a, b) => a < b ? a : b).toISOString().split('T')[0];
  const maxDate = dates.reduce((a, b) => a > b ? a : b).toISOString().split('T')[0];

  const indexHtml = `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CEMERS PHOTOBLOG</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            background: #fff;
        }

        header {
            text-align: center;
            margin-bottom: 2em;
            padding: 1em 0;
            border-bottom: 1px solid #eee;
        }

        header h1 {
            font-size: 2em;
            margin: 0;
            font-weight: 700;
            letter-spacing: -0.02em;
        }

        .article {
            margin-bottom: 2em;
            padding-bottom: 2em;
            border-bottom: 1px solid #eee;
        }

        .article h2 {
            margin: 0;
            font-size: 1.4em;
            font-weight: 600;
            letter-spacing: -0.01em;
        }

        .article-meta {
            color: #666;
            font-size: 0.9em;
            margin: 0.5em 0;
        }

        .article img {
            width: 100%;
            height: 200px;
            object-fit: cover;
            display: block;
            margin: 0.5em 0;
        }

        .article-teaser {
            margin: 0.5em 0;
            color: #444;
            font-size: 1em;
            line-height: 1.5;
        }

        .read-more {
            display: inline-block;
            margin-top: 0.5em;
            font-weight: 500;
            color: #666;
        }

        a {
            color: inherit;
            text-decoration: none;
        }

        a:hover {
            color: #000;
        }

        /* Desktop styles */
        @media (min-width: 768px) {
            header h1 {
                font-size: 2.5em;
            }

            .article-row {
                display: flex;
                gap: 1.5em;
                margin-top: 1em;
            }

            .article-image {
                flex: 0 0 250px;
            }

            .article img {
                width: 250px;
                height: 167px;
                margin: 0;
            }

            .article-content {
                flex: 1;
            }
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }

        .search-container {
            margin: 2em 0;
            padding: 1.5em;
            background: #f5f5f5;
            border-radius: 8px;
        }

        .search-container input[type="text"] {
            width: 100%;
            padding: 10px;
            margin-bottom: 1em;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 1em;
            box-sizing: border-box;
            box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
        }

        .date-filters {
            display: flex;
            gap: 2em;
            margin: 0;
        }

        .date-filters label {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 0.5em;
            font-size: 0.9em;
            color: #666;
        }

        .date-filters input[type="date"] {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 1em;
            font-family: inherit;
            box-sizing: border-box;
        }

        @media (min-width: 768px) {
            .container {
                max-width: 800px;
            }

            .search-container {
                padding: 1.5em;
            }
        }

        @media (min-width: 1200px) {
            .container {
                max-width: 1000px;
            }
        }

        @media (max-width: 768px) {
            .container {
                padding: 15px;
            }

            .search-container {
                padding: 1em;
                margin: 1em 0;
            }

            .date-filters {
                flex-direction: column;
                gap: 1em;
            }
        }

        .article.hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>CEMERS PHOTOBLOG</h1>
        </header>

        <div class="search-container">
            <input type="text" id="searchInput" placeholder="Suche nach Stichworten...">
            <div class="date-filters">
                <label>
                    Von:
                    <input type="date" id="dateFrom" min="${minDate}" max="${maxDate}">
                </label>
                <label>
                    Bis:
                    <input type="date" id="dateTo" min="${minDate}" max="${maxDate}">
                </label>
            </div>
        </div>

        ${articles.map((article, index) => {
          const dateStr = new Date(article.date).toISOString().split('T')[0];
          const firstImage = article.images && article.images[0];
          const imagePath = firstImage ?
            `images/${dateStr}/${firstImage.split('/').pop().split('?')[0]}` : null;

          return `
            <article class="article" data-date="${dateStr}">
                <h2><a href="article-${index + 1}.html">${article.title}</a></h2>
                <div class="article-meta">
                    ${new Date(article.date).toLocaleDateString('de-DE')}
                    ${article.author ? `• ${article.author}` : ''}
                </div>
                <div class="article-row">
                    ${imagePath ?
                      `<div class="article-image">
                        <a href="article-${index + 1}.html">
                          <img loading="lazy" src="${imagePath}" alt="">
                        </a>
                       </div>` : ''}
                    <div class="article-content">
                        <div class="article-teaser">
                            ${article.teaser}
                        </div>
                        <a href="article-${index + 1}.html" class="read-more">Artikel lesen →</a>
                    </div>
                </div>
            </article>
          `;
        }).join('')}
    </div>

    <script>
        function filterArticles() {
            const searchTerms = document.getElementById('searchInput').value
                .toLowerCase()
                .split(' ')
                .filter(term => term.length > 0);
            const dateFrom = document.getElementById('dateFrom').value;
            const dateTo = document.getElementById('dateTo').value;

            document.querySelectorAll('.article').forEach(article => {
                const title = article.querySelector('h2 a').textContent.toLowerCase();
                const teaser = article.querySelector('.article-teaser').textContent.toLowerCase();
                const searchText = title + ' ' + teaser;
                const date = article.dataset.date;

                const matchesSearch = searchTerms.length === 0 ||
                    searchTerms.some(term => searchText.includes(term));

                const matchesDateRange = (!dateFrom || date >= dateFrom) &&
                                       (!dateTo || date <= dateTo);

                article.classList.toggle('hidden', !matchesSearch || !matchesDateRange);
            });
        }

        // Add event listeners
        document.getElementById('searchInput').addEventListener('input', filterArticles);
        document.getElementById('dateFrom').addEventListener('change', filterArticles);
        document.getElementById('dateTo').addEventListener('change', filterArticles);

        // Initialize date inputs with full range
        document.getElementById('dateFrom').value = '${minDate}';
        document.getElementById('dateTo').value = '${maxDate}';
    </script>
</body>
</html>`;

  fs.writeFileSync('output/archive.html', indexHtml);
  console.log(chalk.green('Generated archive.html and article pages'));
}

async function main() {
  const args = process.argv.slice(2);
  const forceReExtract = args.includes('--force');

  if (forceReExtract) {
    console.log(chalk.yellow('Force re-extraction enabled - will process all articles'));
  }

  await updateArticlesWithDetails(forceReExtract);
  await downloadAllImages();
  await generateHtml();
}

main().catch(error => {
  console.log(chalk.red('Error:'), error);
  process.exit(1);
});