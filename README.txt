DEPLOY (functions do NOT work with drag-and-drop; use Git or the CLI)

1. Put this whole folder in a GitHub repo and "Import from Git" in Netlify
   (or run: npm i -g netlify-cli && netlify deploy --prod).
2. Netlify > Site configuration > Environment variables:
   add ADMIN_PASSWORD = your chosen password, then redeploy.
3. Open your site > Administrator > enter the password.
4. Publish from the 📤 button. Viewers update within ~6 seconds.
