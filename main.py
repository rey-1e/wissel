import webview
import sys
import os
import io
import base64
import ctypes
import platform
import tempfile
import uuid
import shutil
import threading
import time
import subprocess
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps, ImageColor

# --- HEIC SUPPORT ---
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

Image.MAX_IMAGE_PIXELS = None

# --- RESOURCE PATH HELPER ---
def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)

class Api:
    def __init__(self):
        self.window = None
        self.file_cache = {}
        self.temp_files = []
        self.stop_flag = False

    def set_window(self, window):
        self.window = window

    def _get_unique_id(self):
        return f"file_{uuid.uuid4().hex}"

    def _create_temp_copy(self, image_data=None, original_path=None):
        fd, path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        self.temp_files.append(path)
        if original_path:
            shutil.copy2(original_path, path)
        elif image_data:
            with open(path, "wb") as f:
                f.write(image_data)
        return path

    def _generate_thumbnail(self, path):
        try:
            img = Image.open(path)
            img = ImageOps.exif_transpose(img)
            img.thumbnail((300, 300))
            buffered = io.BytesIO()
            img.save(buffered, format="PNG")
            return f"data:image/png;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"
        except Exception:
            return None

    def _get_resampling_filter(self, mode_str):
        mode_str = mode_str.lower()
        if mode_str == 'nearest': return Image.Resampling.NEAREST
        if mode_str == 'box': return Image.Resampling.BOX
        if mode_str == 'bilinear': return Image.Resampling.BILINEAR
        if mode_str == 'hamming': return Image.Resampling.HAMMING
        if mode_str == 'bicubic': return Image.Resampling.BICUBIC
        return Image.Resampling.LANCZOS

    def _get_unique_filename(self, path):
        if not os.path.exists(path):
            return path
        base, ext = os.path.splitext(path)
        counter = 1
        while os.path.exists(f"{base}({counter}){ext}"):
            counter += 1
        return f"{base}({counter}){ext}"

    def _save_image_logic(self, source_path, save_path, ops):
        try:
            output_format = ops.get('format', 'JPEG').upper()
            if output_format == 'JPG': output_format = 'JPEG'
            
            resample_filter = self._get_resampling_filter(ops.get('resample_mode', 'Lanczos'))

            if output_format == 'ICO':
                img = Image.open(source_path)
                if ops.get('resize'):
                    img = img.resize((256, 256), resample_filter)
                img.save(save_path, format='ICO')
                return True, None

            img = Image.open(source_path)
            
            exif_data = img.info.get("exif")
            icc_profile = img.info.get("icc_profile")

            img = ImageOps.exif_transpose(img) 

            target_w = int(ops['resize']['width'])
            target_h = int(ops['resize']['height'])
            
            bg_fill_opts = ops.get('bg_fill', None)
            
            if bg_fill_opts and bg_fill_opts.get('enabled'):
                if bg_fill_opts.get('transparent'):
                    bg_color = (0, 0, 0, 0)
                    mode = "RGBA"
                else:
                    hex_col = bg_fill_opts.get('color', '#000000')
                    rgb = ImageColor.getrgb(hex_col)
                    bg_color = rgb
                    mode = "RGB"
                    if img.mode == 'RGBA':
                        mode = "RGBA"
                        if len(bg_color) == 3: bg_color = bg_color + (255,)
                
                img.thumbnail((target_w, target_h), resample_filter)
                canvas = Image.new(mode, (target_w, target_h), bg_color)
                
                pos_x = (target_w - img.size[0]) // 2
                pos_y = (target_h - img.size[1]) // 2
                
                if img.mode == 'RGBA':
                    canvas.paste(img, (pos_x, pos_y), img)
                else:
                    canvas.paste(img, (pos_x, pos_y))
                img = canvas
            else:
                img = img.resize((target_w, target_h), resample_filter)

            if output_format in ['JPEG', 'BMP'] and img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P': img = img.convert('RGBA')
                background.paste(img, mask=img.split()[3])
                img = background
            elif img.mode == 'P':
                img = img.convert('RGBA')

            save_params = {}
            if output_format == 'JPEG':
                save_params['optimize'] = True
            
            if exif_data: save_params['exif'] = exif_data
            if icc_profile: save_params['icc_profile'] = icc_profile

            target_kb = ops.get('target_size_kb', 0)
            
            if target_kb > 0 and output_format in ['JPEG', 'WEBP']:
                current_quality = 95
                min_q = 5
                while current_quality >= min_q:
                    buffer = io.BytesIO()
                    save_params['quality'] = current_quality
                    img.save(buffer, format=output_format, **save_params)
                    if (buffer.tell() / 1024) <= target_kb:
                        with open(save_path, "wb") as f:
                            f.write(buffer.getvalue())
                        return True, None
                    current_quality -= 5
                save_params['quality'] = min_q
                img.save(save_path, format=output_format, **save_params)
            else:
                if output_format in ['JPEG', 'WEBP']:
                    save_params['quality'] = int(ops.get('quality', 90))
                img.save(save_path, format=output_format, **save_params)

            return True, None

        except Exception as e:
            return False, str(e)

    def cancel_processing(self):
        self.stop_flag = True

    def open_file_explorer(self, path):
        try:
            if not os.path.exists(path): return
            if platform.system() == "Windows":
                os.startfile(path)
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
        except: pass

    def process_batch(self, data):
        self.stop_flag = False
        
        def run_thread():
            files = data['files']
            base_ops = data['ops']
            dest_folder = data.get('destinationFolder')
            replace = data.get('replace', False)
            
            total = len(files)
            processed_count = 0
            success_count = 0
            errors = []
            
            lock = threading.Lock()
            
            def process_single_file(file_info):
                nonlocal processed_count, success_count
                if self.stop_flag: return

                source_path = self.file_cache.get(file_info['id'])
                if not source_path:
                    with lock:
                        errors.append(f"{file_info['name']}: File lost")
                        processed_count += 1
                    return

                save_ext = base_ops['format'].lower()
                original_name = os.path.splitext(file_info['name'])[0]
                
                if replace:
                    dir_name = os.path.dirname(source_path)
                    save_path = os.path.join(dir_name, f"{original_name}.{save_ext}")
                else:
                    target_dir = dest_folder if dest_folder else os.path.dirname(source_path)
                    base_filename = f"{original_name}_wissel.{save_ext}"
                    candidate_path = os.path.join(target_dir, base_filename)
                    save_path = self._get_unique_filename(candidate_path)

                success, err_msg = self._save_image_logic(source_path, save_path, base_ops)
                
                with lock:
                    processed_count += 1
                    if success:
                        success_count += 1
                    else:
                        errors.append(f"{file_info['name']}: {err_msg}")
                    
                    progress_pct = int((processed_count / total) * 100)
                    self.window.evaluate_js(f"updateProgress({progress_pct}, '{file_info['name']}')")

            max_threads = min(32, (os.cpu_count() or 4) + 4)
            
            with ThreadPoolExecutor(max_workers=max_threads) as executor:
                futures = [executor.submit(process_single_file, f) for f in files]
                for f in futures:
                    if self.stop_flag: break
                    f.result()

            if self.stop_flag:
                self.window.evaluate_js(f"updateProgress(0, 'Cancelled')")
            else:
                self.window.evaluate_js(f"updateProgress(100, 'Finalizing...')")
            
            time.sleep(0.5)
            
            final_folder = dest_folder
            if not final_folder and files:
                 first_id = files[0]['id']
                 if first_id in self.file_cache:
                     final_folder = os.path.dirname(self.file_cache[first_id])

            report = {
                "total": total,
                "success": success_count,
                "failed": len(errors),
                "errors": errors,
                "cancelled": self.stop_flag,
                "output_dir": final_folder
            }
            self.window.evaluate_js(f"processingComplete({report})")

        thread = threading.Thread(target=run_thread)
        thread.start()

    def get_initial_file(self):
        files = []
        if len(sys.argv) > 1:
            for path in sys.argv[1:]:
                if os.path.exists(path):
                    file_id = self._get_unique_id()
                    self.file_cache[file_id] = os.path.abspath(path)
                    thumb = self._generate_thumbnail(path)
                    if thumb:
                        files.append({"id": file_id, "name": os.path.basename(path), "data": thumb})
        return files

    def browse_image(self):
        file_types = ('Image Files (*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.tiff;*.heic)', 'All files (*.*)')
        result = self.window.create_file_dialog(webview.OPEN_DIALOG, file_types=file_types, allow_multiple=True)
        if result:
            files = []
            for path in result:
                file_id = self._get_unique_id()
                self.file_cache[file_id] = os.path.abspath(path)
                thumb = self._generate_thumbnail(path)
                if thumb:
                    files.append({"id": file_id, "name": os.path.basename(path), "data": thumb})
            return files
        return None

    def browse_folder(self):
        result = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        if result and len(result) > 0: return result[0]
        return None

    def handle_dropped_files(self, file_data_list):
        processed = []
        for item in file_data_list:
            try:
                b64 = item['data'].split(',')[1]
                path = self._create_temp_copy(image_data=base64.b64decode(b64))
                fid = self._get_unique_id()
                self.file_cache[fid] = path
                thumb = self._generate_thumbnail(path)
                processed.append({"id": fid, "name": item['name'], "data": thumb})
            except: pass
        return processed

    def transform_image(self, data):
        try:
            fid = data['id']
            path = self.file_cache.get(fid)
            if not path: return {"success": False}
            img = Image.open(path)
            for t in data['transforms']:
                if t == 'flip_horizontal': img = img.transpose(Image.FLIP_LEFT_RIGHT)
                elif t == 'flip_vertical': img = img.transpose(Image.FLIP_TOP_BOTTOM)
                elif t == 'rotate_90': img = img.rotate(-90, expand=True)
            
            new_path = self._create_temp_copy()
            img.save(new_path, format="PNG")
            self.file_cache[fid] = new_path
            return {"success": True, "data": self._generate_thumbnail(new_path)}
        except Exception as e: return {"success": False, "message": str(e)}

    def install_context_menu(self):
        if platform.system() != 'Windows': return {"success": False, "message": "Windows only."}
        if not ctypes.windll.shell32.IsUserAnAdmin(): return {"success": False, "message": "Run as Admin."}
        try:
            import winreg
            exe = os.path.abspath(sys.argv[0])
            key = winreg.CreateKey(winreg.HKEY_CLASSES_ROOT, r"*\shell\Wissel")
            winreg.SetValue(key, "", winreg.REG_SZ, "Open with Wissel")
            winreg.SetValueEx(key, "Icon", 0, winreg.REG_SZ, exe)
            winreg.CloseKey(key)
            cmd = winreg.CreateKey(winreg.HKEY_CLASSES_ROOT, r"*\shell\Wissel\command")
            winreg.SetValue(cmd, "", winreg.REG_SZ, f'"{exe}" "%1"')
            winreg.CloseKey(cmd)
            return {"success": True, "message": "Installed!"}
        except Exception as e: return {"success": False, "message": str(e)}

    def cleanup(self):
        self.stop_flag = True
        for p in self.temp_files:
            try: os.remove(p)
            except: pass

if __name__ == '__main__':
    # POINTING TO ASSETS FOLDER
    # Since index.html is inside assets, we construct the path: root/assets/index.html
    html_file = resource_path(os.path.join('assets', 'index.html'))

    api = Api()
    window = webview.create_window('Wissel', html_file, js_api=api, width=1250, height=850, min_size=(1000, 700), background_color='#141517')
    api.set_window(window)
    window.events.closed += api.cleanup
    webview.start(debug=False)