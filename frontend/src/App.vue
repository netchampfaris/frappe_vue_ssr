<template>
  <div>
    <h1>Frappe Vue SSR</h1>
    <p>{{ message }}</p>
  </div>
</template>
<script type="application/javascript">
export default {
  name: 'App',
  data() {
    return {
      message: 'Hello Vue!',
    }
  },
}
</script>
