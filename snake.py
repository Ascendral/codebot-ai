"""
Snake Game  -  Python / pygame
Uses pygame.freetype (not pygame.font) to avoid the Python 3.14
circular-import bug: "cannot import name 'Font' from partially
initialized module 'pygame.font'".

Controls:
  Arrow keys or WASD  - steer
  P                   - pause / resume
  R                   - restart
  Q or ESC            - quit

Run:
  python snake.py
"""

import sys
import random

try:
    import pygame
    import pygame.freetype
except ImportError:
    print("pygame is not installed. Run: pip install pygame")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CELL  = 20            # pixels per grid square
COLS  = 30            # grid columns
ROWS  = 25            # grid rows
WIN_W = COLS * CELL   # window width  (600 px)
WIN_H = ROWS * CELL   # window height (500 px)
HUD_H = 44            # header bar height (above grid)
FPS   = 10            # snake ticks per second

# Colours (RGB)
C_BG          = ( 15,  15,  20)
C_GRID        = ( 28,  28,  40)
C_HEAD        = ( 80, 220, 100)
C_BODY        = ( 50, 180,  70)
C_OUTLINE     = ( 25, 100,  45)
C_EYE         = (  0,   0,   0)
C_FOOD        = (220,  60,  60)
C_FOOD_OUT    = (140,  25,  25)
C_STEM        = ( 70, 150,  50)
C_HUD_BG      = ( 20,  20,  30)
C_HUD_LINE    = ( 50,  50,  70)
C_TEXT_BRIGHT = (220, 220, 220)
C_TEXT_DIM    = (110, 110, 130)
C_GOLD        = (255, 200,  50)
C_RED_BANNER  = (140,  25,  25)
C_BLUE_BANNER = ( 25,  45, 120)

# Direction vectors (delta_col, delta_row)
UP    = ( 0, -1)
DOWN  = ( 0,  1)
LEFT  = (-1,  0)
RIGHT = ( 1,  0)

REVERSE = {UP: DOWN, DOWN: UP, LEFT: RIGHT, RIGHT: LEFT}


# ---------------------------------------------------------------------------
# Font helpers  (pygame.freetype — avoids the pygame.font circular-import bug)
# ---------------------------------------------------------------------------

def make_fonts():
    """
    Return (big, mid, small) pygame.freetype.Font objects.
    Falls back to the default built-in font if no system font is found.
    """
    pygame.freetype.init()
    names = ["monospace", "couriernew", "dejavusansmono", None]
    big = mid = small = None
    for name in names:
        try:
            big   = pygame.freetype.SysFont(name, 40, bold=True)
            mid   = pygame.freetype.SysFont(name, 20, bold=True)
            small = pygame.freetype.SysFont(name, 13)
            break
        except Exception:
            continue
    if big is None:
        # Absolute last resort: built-in bitmap font
        big   = pygame.freetype.Font(None, 40)
        mid   = pygame.freetype.Font(None, 20)
        small = pygame.freetype.Font(None, 13)
    return big, mid, small


def blit_text(surf, font, text, color, center=None, topleft=None):
    """
    Render text with pygame.freetype and blit it onto surf.
    Provide either center=(x,y) or topleft=(x,y).
    Returns the blit rect.
    """
    text_surf, text_rect = font.render(text, color)
    if center is not None:
        text_rect.center = center
    elif topleft is not None:
        text_rect.topleft = topleft
    surf.blit(text_surf, text_rect)
    return text_rect


# ---------------------------------------------------------------------------
# Game model
# ---------------------------------------------------------------------------

class Snake:
    def __init__(self):
        cx, cy = COLS // 2, ROWS // 2
        self.body  = [(cx, cy), (cx - 1, cy), (cx - 2, cy)]
        self.dir   = RIGHT
        self._grow = 0

    @property
    def head(self):
        return self.body[0]

    def steer(self, new_dir):
        if new_dir != REVERSE[self.dir]:
            self.dir = new_dir

    def move(self):
        hx, hy = self.head
        dx, dy  = self.dir
        self.body.insert(0, (hx + dx, hy + dy))
        if self._grow > 0:
            self._grow -= 1
        else:
            self.body.pop()

    def grow(self, segments=3):
        self._grow += segments

    def hits_wall(self):
        hx, hy = self.head
        return not (0 <= hx < COLS and 0 <= hy < ROWS)

    def hits_self(self):
        return self.head in self.body[1:]


class Food:
    def __init__(self, snake_body):
        self.pos = (0, 0)
        self.respawn(snake_body)

    def respawn(self, snake_body):
        occupied = set(snake_body)
        free = [(c, r) for c in range(COLS) for r in range(ROWS)
                if (c, r) not in occupied]
        self.pos = random.choice(free) if free else (0, 0)


class Game:
    def __init__(self):
        self.high = 0
        self.reset()

    def reset(self):
        self.snake  = Snake()
        self.food   = Food(self.snake.body)
        self.score  = 0
        self.alive  = True
        self.paused = False

    def tick(self):
        if not self.alive or self.paused:
            return
        self.snake.move()
        if self.snake.hits_wall() or self.snake.hits_self():
            self.alive = False
            self.high  = max(self.high, self.score)
            return
        if self.snake.head == self.food.pos:
            self.snake.grow()
            self.score += 10
            self.high   = max(self.high, self.score)
            self.food.respawn(self.snake.body)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def cell_rect(col, row):
    return pygame.Rect(col * CELL + 1, HUD_H + row * CELL + 1, CELL - 2, CELL - 2)


def draw_grid(surf):
    for c in range(COLS + 1):
        x = c * CELL
        pygame.draw.line(surf, C_GRID, (x, HUD_H), (x, HUD_H + WIN_H))
    for r in range(ROWS + 1):
        y = HUD_H + r * CELL
        pygame.draw.line(surf, C_GRID, (0, y), (WIN_W, y))


def draw_snake(surf, snake):
    for i, (col, row) in enumerate(snake.body):
        rect = cell_rect(col, row)
        if i == 0:
            pygame.draw.rect(surf, C_HEAD,    rect, border_radius=5)
            pygame.draw.rect(surf, C_OUTLINE, rect, width=1, border_radius=5)
            dx, dy = snake.dir
            cx_px  = col * CELL + CELL // 2
            cy_px  = HUD_H + row * CELL + CELL // 2
            perp   = (-dy, dx)
            for sign in (1, -1):
                ex = int(cx_px + dx * 5 + sign * perp[0] * 4)
                ey = int(cy_px + dy * 5 + sign * perp[1] * 4)
                pygame.draw.circle(surf, C_EYE, (ex, ey), 2)
        else:
            fade   = max(40, 220 - i * 5)
            factor = fade / 220.0
            colour = tuple(int(v * factor) for v in C_BODY)
            pygame.draw.rect(surf, colour,     rect, border_radius=3)
            pygame.draw.rect(surf, C_OUTLINE,  rect, width=1, border_radius=3)


def draw_food(surf, food, tick):
    col, row = food.pos
    pulse  = abs((tick % 30) - 15) / 15.0
    radius = int(CELL * (0.55 + 0.08 * pulse))
    cx_px  = col * CELL + CELL // 2
    cy_px  = HUD_H + row * CELL + CELL // 2
    pygame.draw.circle(surf, C_FOOD,     (cx_px, cy_px), radius)
    pygame.draw.circle(surf, C_FOOD_OUT, (cx_px, cy_px), radius, 1)
    sx = cx_px + radius // 3
    pygame.draw.line(surf, C_STEM, (sx, cy_px - radius), (sx, cy_px - radius - 5), 2)


def draw_hud(surf, game, mid_font, small_font):
    pygame.draw.rect(surf, C_HUD_BG, pygame.Rect(0, 0, WIN_W, HUD_H))
    pygame.draw.line(surf, C_HUD_LINE, (0, HUD_H - 1), (WIN_W, HUD_H - 1))

    # Score on the left
    blit_text(surf, mid_font,   f"SCORE  {game.score:>6}", C_TEXT_BRIGHT, topleft=(12, 6))
    blit_text(surf, small_font, f"BEST   {game.high:>6}",  C_TEXT_DIM,    topleft=(12, 28))

    # Controls hint on the right
    hint = "Arrows/WASD  |  P pause  |  R restart  |  ESC quit"
    hint_surf, hint_rect = small_font.render(hint, C_TEXT_DIM)
    surf.blit(hint_surf, (WIN_W - hint_rect.width - 10, HUD_H // 2 - hint_rect.height // 2))


def draw_overlay(surf, title, subtitle, big_font, small_font):
    # Semi-transparent dark shade over the whole screen
    shade = pygame.Surface((WIN_W, WIN_H + HUD_H), pygame.SRCALPHA)
    shade.fill((0, 0, 0, 180))
    surf.blit(shade, (0, 0))

    cx = WIN_W // 2
    cy = (WIN_H + HUD_H) // 2

    # Colour-coded banner box
    is_dead  = "OVER" in title or "GAME" in title
    banner_c = C_RED_BANNER if is_dead else C_BLUE_BANNER

    box = pygame.Rect(0, 0, 420, 110)
    box.center = (cx, cy)
    pygame.draw.rect(surf, banner_c, box, border_radius=12)
    pygame.draw.rect(surf, C_GOLD,   box, width=2, border_radius=12)

    # Title (large, gold)
    blit_text(surf, big_font,   title,    C_GOLD,        center=(cx, cy - 20))
    # Subtitle (small, bright)
    blit_text(surf, small_font, subtitle, C_TEXT_BRIGHT, center=(cx, cy + 32))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    pygame.init()
    screen = pygame.display.set_mode((WIN_W, WIN_H + HUD_H))
    pygame.display.set_caption("Snake")
    clock = pygame.time.Clock()

    big_font, mid_font, small_font = make_fonts()

    DIR_MAP = {
        pygame.K_UP:    UP,    pygame.K_w: UP,
        pygame.K_DOWN:  DOWN,  pygame.K_s: DOWN,
        pygame.K_LEFT:  LEFT,  pygame.K_a: LEFT,
        pygame.K_RIGHT: RIGHT, pygame.K_d: RIGHT,
    }
    QUIT_KEYS = {pygame.K_ESCAPE, pygame.K_q}

    game = Game()
    tick = 0

    # ---- start screen -------------------------------------------------------
    waiting = True
    while waiting:
        clock.tick(30)
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            if event.type == pygame.KEYDOWN:
                if event.key in QUIT_KEYS:
                    pygame.quit()
                    sys.exit()
                if event.key in DIR_MAP:
                    game.snake.steer(DIR_MAP[event.key])
                    waiting = False

        screen.fill(C_BG)
        draw_grid(screen)
        draw_hud(screen, game, mid_font, small_font)
        draw_overlay(screen,
                     "SNAKE",
                     "Press an arrow key or WASD to begin",
                     big_font, small_font)
        pygame.display.flip()

    # ---- game loop ----------------------------------------------------------
    while True:
        clock.tick(FPS)
        tick += 1

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            if event.type == pygame.KEYDOWN:
                if event.key in QUIT_KEYS:
                    pygame.quit()
                    sys.exit()
                elif event.key == pygame.K_r:
                    game.reset()
                elif event.key == pygame.K_p and game.alive:
                    game.paused = not game.paused
                elif event.key in DIR_MAP and game.alive:
                    game.snake.steer(DIR_MAP[event.key])

        game.tick()

        screen.fill(C_BG)
        draw_grid(screen)
        draw_food(screen, game.food, tick)
        draw_snake(screen, game.snake)
        draw_hud(screen, game, mid_font, small_font)

        if not game.alive:
            draw_overlay(screen,
                         f"GAME OVER  -  {game.score} pts",
                         "R to restart  |  ESC to quit",
                         big_font, small_font)
        elif game.paused:
            draw_overlay(screen,
                         "PAUSED",
                         "P to resume  |  R to restart",
                         big_font, small_font)

        pygame.display.flip()


if __name__ == "__main__":
    main()
