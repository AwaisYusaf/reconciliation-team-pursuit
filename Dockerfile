# Runtime image for the reconciliation app.
#
# Debian-based rather than Alpine on purpose: the app shells out to LibreOffice and poppler
# to build cover sheets and packets, and both are a single apt install here. The host running
# this is Amazon Linux 2023, where LibreOffice is not in the default repositories at all —
# containerising is what makes the document toolchain reproducible.
FROM node:22-bookworm-slim

# soffice converts each cover sheet docx to PDF; pdftoppm/pdfinfo rasterise uploaded PDFs
# into packet pages. Carlito is metric-compatible with Calibri, so the converted PDF breaks
# lines where Word does — without it the PDF silently stops matching the docx.
RUN apt-get update && apt-get install --no-install-recommends -y \
      libreoffice-writer \
      poppler-utils \
      fonts-crosextra-carlito \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
# `npm ci` includes devDependencies deliberately: drizzle-kit runs the migrations and tsx
# runs the operator password reset, and both are needed in the running container.
RUN npm ci

COPY . .

# NODE_ENV=production is already set, so the build produces a production bundle.
RUN npm run build

# Where uploads and generated artifacts land when the local storage driver is used. With
# S3_BUCKET set this stays empty, but the directory exists so a fallback cannot fail on a
# missing path.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

# Next binds 0.0.0.0 by default in a container; Caddy reaches it by service name.
CMD ["npm", "run", "start"]
