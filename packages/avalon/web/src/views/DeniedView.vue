<script setup lang="ts">
defineProps<{ message: string | null }>();
</script>

<template>
  <div class="center-msg">
    <h2>無存取權限</h2>
    <p>{{ message }}</p>
    <p class="hint">請回到 Discord 重新取得連結。</p>
  </div>
</template>

<style scoped>
.hint {
  margin-top: 1rem;
  font-size: 0.85rem;
}
</style>
