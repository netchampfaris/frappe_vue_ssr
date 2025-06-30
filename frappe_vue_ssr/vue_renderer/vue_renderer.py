import os
import json
import subprocess
import logging
import frappe
from frappe.website.page_renderers.base_template_page import BaseTemplatePage
from frappe.utils.logger import get_logger

# Create logger for frappe_vue_ssr
logger = get_logger("frappe_vue_ssr")

class VueRenderer(BaseTemplatePage):
    def __init__(self, path, http_status_code=None):
        super().__init__(path=path, http_status_code=http_status_code)
        self.set_vue_template_path()

    def set_vue_template_path(self):
        """
        Searches for .vue files matching the path in the /www folders
        """
        self.vue_file_path = None
        self.vue_component_content = None

        # Search through all installed apps
        for app in reversed(frappe.get_installed_apps()):
            app_path = frappe.get_app_path(app)

            # Look in the www directory for a .vue file
            vue_file_path = os.path.join(app_path, "www", self.path + ".vue")

            if os.path.isfile(vue_file_path):
                self.app = app
                self.app_path = app_path
                self.vue_file_path = vue_file_path
                self.template_path = os.path.relpath(vue_file_path, app_path)
                self.basepath = os.path.dirname(vue_file_path)
                self.filename = os.path.basename(vue_file_path)
                self.name = os.path.splitext(self.filename)[0]

                logger.info(f"Found Vue file: {vue_file_path} in app: {app}")

                # Read the Vue component content
                with open(vue_file_path, 'r', encoding='utf-8') as f:
                    self.vue_component_content = f.read()

                return

    def can_render(self):
        """
        Return True if we found a .vue file for this path
        """
        return self.vue_file_path is not None and os.path.isfile(self.vue_file_path)

    def render(self):
        """
        Render the Vue component to HTML using Node.js Vue SSR
        """
        html = self.get_html()
        html = self.add_csrf_token(html)
        return self.build_response(html)

    def get_html(self):
        """
        Build and return complete HTML for the Vue page
        """
        self.init_context()
        self.update_context()
        self.post_process_context()

        # Use Node.js for proper Vue SSR
        html = self.render_vue_with_nodejs()

        return html

    def get_compatible_node_command(self):
        """
        Find Node.js v22+
        """
        # Try different Node.js commands in order of preference
        # Include common paths for Node.js v22 installations
        node_commands = [
            "node22",                                    # Direct v22 command
            "/opt/homebrew/bin/node22",                  # Homebrew v22 on Apple Silicon
            "/usr/local/bin/node22",                     # Homebrew v22 on Intel Mac
            "/opt/homebrew/bin/node",                    # Homebrew default on Apple Silicon
            "/usr/local/bin/node",                       # Homebrew default on Intel Mac
            "node",                                      # System default
            "/usr/bin/node",                             # System installation
        ]

        v22_nodes = []
        other_nodes = []

        for cmd in node_commands:
            try:
                # Check if the command exists and get version
                result = subprocess.run([cmd, "--version"], capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    version = result.stdout.strip()
                    print(f"Found Node.js: {cmd} -> {version}")
                    logger.debug(f"Found Node.js: {cmd} -> {version}")

                    # Extract major version number
                    if version.startswith('v'):
                        major_version = int(version[1:].split('.')[0])

                        if major_version >= 22:
                            v22_nodes.append((cmd, major_version, version))
                            logger.debug(f"Node.js v{major_version} meets v22+ requirement: {cmd}")
                        elif major_version >= 18:
                            other_nodes.append((cmd, major_version, version))
                            logger.debug(f"Node.js v{major_version} found but below v22 requirement: {cmd}")

            except (subprocess.SubprocessError, ValueError, FileNotFoundError):
                continue

        # Only use Node.js v22+ - it's a hard requirement
        if v22_nodes:
            # Sort by version (highest first) and return the best v22+ option
            v22_nodes.sort(key=lambda x: x[1], reverse=True)
            cmd, major_version, version = v22_nodes[0]
            print(f"✅ Using Node.js {version} (meets v22+ requirement)")
            logger.info(f"Selected Node.js {version} at {cmd} for Vue SSR")
            return cmd

        # If no v22+ found, show helpful error message
        error_msg = "❌ Node.js v22 or higher is required for Vue SSR.\n"

        if other_nodes:
            error_msg += f"Found Node.js versions: {', '.join([node[2] for node in other_nodes])}\n"
            logger.error(f"No compatible Node.js v22+ found. Available versions: {', '.join([node[2] for node in other_nodes])}")
        else:
            logger.error("No Node.js installation found on system")

        error_msg += """
Installation options:
- Using Homebrew: brew install node@22
- Using Node Version Manager: nvm install 22 && nvm use 22
- Download from: https://nodejs.org/

After installation, you may need to restart your Frappe server.
"""

        logger.error("Vue SSR rendering failed due to missing Node.js v22+")
        frappe.throw(error_msg, title="Node.js v22+ Required")
        return None  # This won't be reached due to frappe.throw

    def render_vue_with_nodejs(self):
        """
        Use Node.js with official Vue SSR packages to render the component
        """
        logger.info(f"Starting Vue SSR rendering for {self.vue_file_path}")

        try:
            # Get the path to our Node.js SSR renderer (in the root directory of the app)
            app_root = os.path.dirname(self.app_path)  # Go up one level from wiki/wiki to wiki/
            current_dir = os.path.dirname(os.path.abspath(__file__))
            renderer_path = os.path.join(current_dir, "vue_ssr_renderer.js")

            if not os.path.exists(renderer_path):
                logger.error(f"Node.js Vue SSR renderer not found at {renderer_path}")
                return self._fallback_html(f"Node.js Vue SSR renderer not found at {renderer_path}")

            # Prepare server data to pass to Vue component
            server_data = self.prepare_server_data()

            # Get compatible Node.js command
            node_cmd = self.get_compatible_node_command()

            # Call Node.js renderer
            cmd = [node_cmd, renderer_path, self.vue_file_path, json.dumps(server_data)]

            # Debug output
            logger.debug(f"Working directory: {app_root}")
            logger.debug(f"Vue SSR Command: {' '.join(cmd)}")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,  # 30 second timeout
                cwd=app_root  # Run from the app root directory
            )

            if result.returncode != 0:
                error_msg = result.stderr or "Node.js renderer failed"
                logger.error(f"Vue SSR subprocess failed with return code {result.returncode}: {error_msg}")
                frappe.log_error(f"Vue SSR Error: {error_msg}", "Vue Renderer")
                return self._fallback_html(f"Vue SSR Error: {error_msg}")

            # Parse the JSON response from Node.js
            try:
                response = json.loads(result.stdout)
            except json.JSONDecodeError as e:
                logger.error(f"Vue SSR JSON Parse Error: {str(e)}")
                logger.error(f"Raw stdout was: {result.stdout}")
                frappe.log_error(f"Vue SSR JSON Parse Error: {str(e)}", "Vue Renderer")
                frappe.log_error(f"Raw stdout was: {result.stdout}", "Vue Renderer")
                return self._fallback_html(f"Invalid JSON response from Vue SSR: {str(e)}")

            if not response.get('success'):
                error_msg = response.get('error', 'Unknown error')
                html = response.get('html', '')
                logger.error(f"Vue SSR renderer reported failure: {error_msg}")
                return self._fallback_html(html)

            logger.info(f"Vue SSR rendering completed successfully for {self.vue_file_path}")

            logger.info(response.get('html'))

            # Build the complete HTML response
            return self.build_complete_html(
                response.get('html', ''),
                response.get('styles', ''),
                response.get('clientBundleUrl', ''),
                response.get('serverDataScript', '')
            )

        except subprocess.TimeoutExpired:
            logger.error("Vue SSR renderer timed out after 30 seconds")
            frappe.log_error("Vue SSR renderer timed out after 30 seconds", "Vue Renderer")
            return self._fallback_html("Vue SSR renderer timed out")
        except Exception as e:
            logger.error(f"Vue SSR Exception: {str(e)}")
            frappe.log_error(f"Vue SSR Exception: {str(e)}", "Vue Renderer")
            return self._fallback_html(f"Vue SSR Exception: {str(e)}")

    def prepare_server_data(self):
        """
        Prepare data to pass to the Vue component for server-side rendering
        """
        # You can add dynamic server data here
        # For example, user data, API responses, etc.
        server_data = {
            # Add any server-side data that should be available to the Vue component
            "serverTime": frappe.utils.now(),
            "user": frappe.session.user,
            "siteName": frappe.local.site or "localhost"
        }

        return server_data

    def build_complete_html(self, rendered_html, styles, client_bundle_url, server_data_script):
        """
        Build the complete HTML page with Vue SSR content
        """
        # Vue is now bundled in the client bundle, so no CDN script needed
        is_development = frappe.conf.get('developer_mode') or frappe.conf.get('debug')

        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>{self.context.get('title', 'Vue Page')}</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <!-- Vue is bundled in the client JavaScript, no CDN needed -->
            <style>
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    margin: 0;
                    padding: 20px;
                    line-height: 1.6;
                }}
                .vue-ssr-rendered {{
                    color: #2c3e50;
                }}
                .server-rendered {{
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 12px 20px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }}
                .server-rendered small {{
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }}

                /* Vue Component Styles */
                {styles}
            </style>
        </head>
        <body>
            <div class="server-rendered">
                <small>
                    🔥 Server-side rendered with Python + Node.js + Vue SSR (Self-contained Bundle)
                    <span style="opacity: 0.8;">({frappe.utils.now()})</span>
                </small>
            </div>
            <div id="app" class="vue-ssr-rendered">{rendered_html}</div>

            <script>
                // Inject server data for hydration
                {server_data_script}
            </script>

            {self._generate_client_script_tag(client_bundle_url)}

            <script>
                console.log('🚀 Vue app hydrated with self-contained bundle!');
            </script>
        </body>
        </html>
        """

    def _fallback_html(self, html):
        """
        Fallback HTML when Vue SSR fails
        """
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Vue SSR Error</title>
            <meta charset="utf-8">
            <style>
                body {{ font-family: Arial, sans-serif; margin: 40px; }}
                .error {{
                    background: #fee;
                    border: 1px solid #f88;
                    padding: 20px;
                    border-radius: 4px;
                    color: #c33;
                }}
                .fallback {{
                    background: #fff3cd;
                    border: 1px solid #ffeaa7;
                    padding: 15px;
                    border-radius: 4px;
                    margin-top: 20px;
                }}
            </style>
        </head>
        <body>
            <div class="error">
                {html}
            </div>
            <div class="fallback">
                <p><strong>Note:</strong> This is a fallback view. The Vue component could not be server-rendered.</p>
                <p>Vue file: <code>{self.vue_file_path}</code></p>
            </div>
        </body>
        </html>
        """

    def _generate_client_script_tag(self, client_bundle_url):
        """
        Generate script tag for client bundle, handling both local files and CDN URLs
        """
        if not client_bundle_url:
            return "<!-- No client bundle available -->"

        # If it's a local file path, set up static serving
        if client_bundle_url.startswith('/'):
            # Register the client bundle for static serving
            self._register_static_file(client_bundle_url)
            return f'<script src="{client_bundle_url}"></script>'
        else:
            # External URL
            return f'<script src="{client_bundle_url}"></script>'

    def _register_static_file(self, file_url):
        """
        Register a static file to be served by Frappe
        Frappe automatically serves files from public folders as assets
        """
        # Frappe automatically serves files from {app}/public/* as /assets/{app}/*
        # So files in {app}/public/ssr/ are served at /assets/{app}/ssr/
        # No additional registration needed - just ensure the file exists

        if file_url.startswith(f'/assets/{self.app}/ssr/'):
            # Extract filename from URL
            filename = file_url.split('/')[-1]
            expected_path = os.path.join(self.app_path, 'public', 'ssr', filename)

            if not os.path.exists(expected_path):
                logger.error(f"Vue client bundle not found at {expected_path}")
                frappe.log_error(f"Vue client bundle not found at {expected_path}", "Vue Renderer")
                return False

            logger.debug(f"Vue client bundle found at {expected_path}")
            return True

        logger.warning(f"Unrecognized static file URL pattern: {file_url}")
        return False

    def update_context(self):
        """
        Set up context for the Vue component
        """
        self.context.title = f"Vue SSR: {self.name}"
        self.context.path = self.path
        self.context.vue_file = self.filename
