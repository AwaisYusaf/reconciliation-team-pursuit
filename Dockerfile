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

# Point Aptos — the cover sheet's font — at Carlito (D-78).
#
# Installing Carlito is not enough on its own: fontconfig ships it as a metric substitute for
# *Calibri*, and nothing in the image mentions Aptos, so `fc-match Aptos` returned DejaVu Sans,
# the generic sans fallback. Every cover sheet this container has ever rendered used it. DejaVu
# is about a quarter wider than Calibri per digit, which is why the yellow total broke
# mid-number in the packet while the same document looked correct everywhere else, and why the
# page estimate — whose constants assume roughly half the point size per character — drifted.
RUN printf '%s\n' \
      '<?xml version="1.0"?>' \
      '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
      '<fontconfig>' \
      '  <match target="pattern">' \
      '    <test qual="any" name="family"><string>Aptos</string></test>' \
      '    <edit name="family" mode="assign" binding="same"><string>Carlito</string></edit>' \
      '  </match>' \
      '</fontconfig>' \
      > /etc/fonts/conf.d/30-aptos-carlito.conf \
 && fc-cache -f \
 && fc-match Aptos | grep -q Carlito

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./

# Match the npm that wrote package-lock.json. The version is read out of package.json's
# `packageManager` field rather than hardcoded, so the two can never drift apart.
#
# This is not housekeeping: npm 10 (which node:22 bundles) and npm 11 resolve transitive
# optional dependencies differently, so a lockfile written by 11 makes `npm ci` under 10 fail
# with "Missing: @emnapi/core@... from lock file" — packages that are present, at a version
# and position the older resolver does not agree with.
RUN npm i -g "npm@$(node -p "require('./package.json').packageManager.split('@')[1]")"

# --include=dev is load-bearing, not belt-and-braces: NODE_ENV=production is set above, and
# npm reads it and omits devDependencies. Without the flag this installs 189 packages instead
# of 568 — dropping @tailwindcss/postcss, so `next build` cannot compile globals.css, and
# dropping drizzle-kit and tsx, so `db:migrate` and `db:reset-password` would fail in the
# running container. All three are devDependencies this image genuinely needs.
RUN npm ci --include=dev

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
