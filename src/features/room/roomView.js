export function renderRoomScene(root) {
  root.innerHTML = `<main class="demo-shell">
    <section class="scene" id="scene" aria-label="Interactive bedroom wardrobe scene">
      <div class="stage" id="stage">
      <div class="world" id="world">
        <img class="room-bg" src="/src/assets/room.png" alt="" draggable="false" />
        <div class="window-weather-viewport" id="windowWeatherViewport" aria-hidden="true">
          <img
            class="window-weather-scene"
            id="windowWeatherScene"
            alt=""
            draggable="false"
          />
</div>
        <button
          class="window-curtain-zone"
          id="windowCurtainZone"
          type="button"
          aria-label="获取天气并打开窗帘"
          aria-pressed="false"
          title="点击获取当前天气并打开窗帘"
        >
          <img
            class="curtain curtain--left"
            src="/src/assets/curtain_left.png"
            alt=""
            draggable="false"
          />
          <img
            class="curtain curtain--right"
            src="/src/assets/curtain_right.png"
            alt=""
            draggable="false"
          />
        </button>
        <div
          class="room-weather-summary"
          id="roomWeatherSummary"
          aria-live="polite"
          title="点击窗帘获取当前天气"
          style="transform: translateY(-24px);"
        >
          <span class="room-weather-summary__temperature" id="roomWeatherTemperature">--°C</span>
          <span class="room-weather-summary__condition" id="roomWeatherCondition">天气待获取</span>
        </div>
        <div
          id="roomWeatherAdvice"
          aria-live="polite"
          title="获取天气后显示穿衣建议"
          style="
            position:absolute;
            left:32.9%;
            top:calc(25.5% - 20px);
            z-index:9;
            max-width:calc(45.35% - 32.9% - 14px);
            padding:1px 8px;
            border:1px solid rgba(92,68,51,.10);
            border-radius:12px;
            background:rgba(255,250,246,.80);
            box-shadow:0 3px 10px rgba(71,49,35,.05);
            backdrop-filter:blur(8px);
            color:#5f493c;
            font-size:clamp(14px,.82vw,15px);
            font-weight:750;
            line-height:1.18;
            white-space:normal;
            overflow-wrap:anywhere;
            display:-webkit-box;
            -webkit-box-orient:vertical;
            -webkit-line-clamp:4;
            overflow:hidden;
            pointer-events:none;
          "
        >适宜：获取天气后显示</div>
        <img class="wardrobe" id="wardrobe" src="/src/assets/wardrobe_male.png" alt="男生衣柜，点击放大查看" draggable="false" />
        <div class="character-stage" id="characterStage">
          <img class="character" id="character" src="/src/assets/character_male.png" alt="男生角色" draggable="false" />
          <img class="wearable-layer wearable-pants" id="wearable-pants" alt="" draggable="false" />
          <img class="wearable-layer wearable-top" id="wearable-top" alt="" draggable="false" />
          <img class="wearable-layer wearable-coat" id="wearable-coat" alt="" draggable="false" />
          <img class="wearable-layer wearable-hat" id="wearable-hat" alt="" draggable="false" />
        </div>

        <div class="wardrobe-tools" id="wardrobeTools" aria-label="衣柜分类">
          <div class="wardrobe-hotspots" id="categoryMenu">
            <button class="wardrobe-hotspot" type="button" data-category="hat" aria-label="帽子"></button>
            <button class="wardrobe-hotspot" type="button" data-category="top" aria-label="上衣"></button>
            <button class="wardrobe-hotspot" type="button" data-category="pants" aria-label="裤子"></button>
          </div>

          <div class="item-grid-panel" id="itemGridPanel" aria-label="衣物格子"></div>

          <div class="selection-actions" id="selectionActions" aria-label="衣物选择操作">
            <button class="selection-action-btn" id="rotateItemBtn" type="button" hidden title="顺时针旋转 90°，可连续点击">旋转</button>
            <button class="selection-action-btn danger" id="deleteItemBtn" type="button" hidden title="删除这件自定义衣物">删除</button>
            <button class="selection-action-btn" id="cancelSelectionBtn" type="button">返回</button>
            <button class="selection-action-btn danger" id="takeOffBtn" type="button" hidden>脱下</button>
            <button class="selection-action-btn confirm" id="confirmSelectionBtn" type="button">确认</button>
          </div>

          <div class="profile-preview" id="profilePreview">
            <div class="profile-window">
              <h3 class="profile-window-title">简介</h3>
              <div class="profile-window-content" id="profileContent"></div>
            </div>
            <button class="profile-edit-btn" id="profileEditBtn" type="button">修改</button>
          </div>
        </div>
      </div>
      </div>

      <div class="topbar">
        <div class="gender-switch" id="genderSwitch" data-gender="male" aria-label="切换角色性别">
          <button class="gender-btn" type="button" data-gender="male" aria-pressed="true">♂ 男生</button>
          <button class="gender-btn" type="button" data-gender="female" aria-pressed="false">♀ 女生</button>
        </div>
      </div>

      <div class="hint">点击左侧衣柜查看</div>

    </section>
  </main>`;
}
