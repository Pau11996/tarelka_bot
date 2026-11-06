FROM nginx:1.27-alpine

RUN apk add --no-cache gettext wget

COPY nginx.conf.template /opt/nginx.conf.template
COPY public/ /usr/share/nginx/html/
COPY docker-entrypoint.sh /docker-entrypoint.sh

# Git checkouts may use a restrictive umask. Nginx workers must still be able
# to traverse public directories and read static assets copied into the image.
RUN find /usr/share/nginx/html -type d -exec chmod 755 {} + \
    && find /usr/share/nginx/html -type f -exec chmod 644 {} + \
    && chmod 755 /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
