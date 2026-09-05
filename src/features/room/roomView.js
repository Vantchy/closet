export function renderRoomScene(root) {
  root.innerHTML = `<main class="demo-shell">
    <section class="scene" id="scene" aria-label="Interactive bedroom wardrobe scene">
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
        >
          <span class="room-weather-summary__temperature" id="roomWeatherTemperature">--°C</span>
          <span class="room-weather-summary__condition" id="roomWeatherCondition">天气待获取</span>
        </div>
        <img class="wardrobe" id="wardrobe" src="/src/assets/wardrobe_male.png" alt="男生衣柜，点击放大查看" draggable="false" />
        <div class="character-stage" id="characterStage">
          <img class="character" id="character" src="/src/assets/character_male.png" alt="男生角色" draggable="false" />
          <img class="wearable-layer wearable-pants" id="wearable-pants" alt="" draggable="false" />
          <img class="wearable-layer wearable-top" id="wearable-top" alt="" draggable="false" />
          <img class="wearable-layer wearable-coat" id="wearable-coat" alt="" draggable="false" />
          <img class="wearable-layer wearable-hat" id="wearable-hat" alt="" draggable="false" />
        </div>
      </div>

      <div class="wardrobe-tools" id="wardrobeTools" aria-label="衣柜分类">
        <div class="category-menu" id="categoryMenu">
          <button class="category-btn" type="button" data-category="hat" aria-pressed="false">帽子</button>
          <button class="category-btn" type="button" data-category="top" aria-pressed="false">上衣</button>
          <button class="category-btn" type="button" data-category="coat" aria-pressed="false">外套</button>
          <button class="category-btn" type="button" data-category="pants" aria-pressed="false">裤子</button>
        </div>

        <div class="item-grid-panel" id="itemGridPanel" aria-label="衣物格子"></div>

        <div class="selection-actions" id="selectionActions" aria-label="衣物选择操作">
          <button class="selection-action-btn" id="cancelSelectionBtn" type="button">返回</button>
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

      <div class="topbar">
        <div class="gender-switch" id="genderSwitch" data-gender="male" aria-label="切换角色性别">
          <button class="gender-btn" type="button" data-gender="male" aria-pressed="true">♂ 男生</button>
          <button class="gender-btn" type="button" data-gender="female" aria-pressed="false">♀ 女生</button>
        </div>
      </div>

      <div class="hint">点击左侧衣柜查看</div>

      <aside class="integration-dock" aria-label="项目扩展功能">
        <section class="integration-card" id="photoCard">
          <h2 class="integration-card__title">本地照片</h2>
          <div class="integration-card__row">
            <input id="photoInput" type="file" accept="image/png,image/jpeg,image/webp" hidden />
            <button class="integration-button" id="photoSelectBtn" type="button">选择照片</button>
            <button class="integration-button" id="photoClearBtn" type="button" disabled>清除</button>
            <img class="photo-preview" id="photoPreview" alt="本地照片预览" />
          </div>
          <p class="integration-status" id="photoStatus">照片只在浏览器本地预览；只有执行 AI 试穿时才会发送给本地后端。</p>
        </section>


        <section class="integration-card" id="tryOnCard">
          <h2 class="integration-card__title">AI 试穿</h2>
          <div class="integration-card__row">
            <button class="integration-button" id="tryOnButton" type="button" disabled>试穿已确认衣物</button>
            <img class="tryon-result" id="tryOnResult" alt="AI 试穿结果" />
          </div>
          <p class="integration-status" id="tryOnStatus">先上传人物照片，再在衣柜中确认一件上衣、外套或裤子。</p>
        </section>
      </aside>

    </section>
  </main>`;
}
