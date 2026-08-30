FROM nginx:1.27-alpine

COPY index.html styles.css app.js lessons.json /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Do not cache the UI bundle: students must receive the current simulator release.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
