# Dedicated host Nginx site

This template creates a separate `APP_DOMAIN` virtual host. It intentionally has
no `default_server` listener and does not modify, disable, or replace the existing
`worldcup-lottery` default site.

Before enabling it, point the domain's A/AAAA record to the VPS. Render only the
application-domain variable so Nginx runtime variables remain intact:

```sh
sudo env APP_DOMAIN=quotation.example.com sh -c \
  'envsubst '\''${APP_DOMAIN}'\'' < deploy/nginx/sales-quotation.conf.template > /etc/nginx/sites-available/sales-quotation.conf'
sudo ln -s /etc/nginx/sites-available/sales-quotation.conf /etc/nginx/sites-enabled/sales-quotation.conf
sudo nginx -t
sudo systemctl reload nginx
```

After HTTP routing and DNS are verified, obtain and install a certificate using
the host's existing Certbot integration:

```sh
sudo certbot --nginx -d quotation.example.com
sudo nginx -t
```

Certbot adds the dedicated TLS listener and renewal configuration to this vhost.
The configured HSTS header is ignored by browsers over plain HTTP and becomes
effective only over HTTPS after Certbot enables TLS on this same vhost. Confirm
the TLS-enabled vhost retains the `Strict-Transport-Security` header with
`sudo nginx -T`, then re-run `nginx -t` before every reload. Do not edit the
existing default site.
