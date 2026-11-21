# Our Lists

A shared to-do and shopping list app for two people. It works in Safari on iPhone
and can be added to the Home Screen like a normal app. Changes show up on the
other phone within a second or two.

## How it is built
- Plain HTML, CSS and JavaScript. No build step.
- **Supabase** (free plan) stores the lists and handles sign-in. Only the email
  addresses in the `allowed_emails` table can see or change anything.
- **GitHub Pages** hosts the files for free.

## One-time setup
1. In Supabase, open **SQL Editor**, paste `schema.sql`, change the two email
   addresses near the top, and press **Run**.
2. Put your Supabase Project URL and anon key in `config.js`.
3. In Supabase **Authentication → URL Configuration**, set **Site URL** to the
   app's web address, so confirmation emails link back to it.
4. In GitHub, **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`.

## Adding another person later
Run this in the Supabase SQL Editor:
```sql
insert into allowed_emails (email) values ('new.person@example.com');
```
